---
layout: page
title: 04_Área_GlobalEcosystemTypology
parent: "Introducción a GEE"
nav_order: 5
---

# 04_Área_GlobalEcosystemTypology
## Objetivo
1. Definir un área de interés (Parque Nacional Chingaza).
2. Calcular el área de cada tipo de ecosistema interceptado con el ROI, usando el mapa global de la IUCN y el mapa nacional de Colombia.
3. Visualizar los ecosistemas IUCN coloreados por categoría, con leyenda dinámica.
4. Exportar las estadísticas de ambos mapas a Google Drive.

## Datos
- Áreas protegidas (WDPA), collection: `WCMC/WDPA/current/polygons`
<p align="center">
  <img src="{{ '/images/intro-gee/fig14.png' | relative_url }}" width="600" style="margin: 10px 0;">
</p>

- Tipología Global de Ecosistemas (IUCN), collection: `IUCN/GlobalEcosystemTypology/current`

<p align="center">
  <img src="{{ '/images/intro-gee/fig13.png' | relative_url }}" width="600" style="margin: 10px 0;">
</p>

- Mapa de ecosistemas de Colombia (asset del proyecto), collection: `projects/ee-paulapaz1101/assets/biodiversity_workshop/GEODATA/ecosystem_map_COL`

## Método
1. Intersección de geometrías con `.intersection()` para recortar cada ecosistema al límite exacto del área protegida.
2. Cálculo de área con `.area()`, convertida de m² a hectáreas.
3. Agrupación y suma de áreas por categoría de ecosistema usando `reduceColumns()` con `ee.Reducer.sum().group()`.

## Paso a paso
## Paso 1: Definir el área de interés

Cargar la colección de áreas protegidas (`WCMC/WDPA/current/polygons`) y filtrarla con `ee.Filter.eq()` para obtener el polígono correspondiente al Parque Nacional Chingaza. Centrar el mapa sobre el resultado.

```javascript
var WDPA = ee.FeatureCollection("WCMC/WDPA/current/polygons");
var roi = WDPA.filter(
  ee.Filter.eq('NAME', 'Chingaza'));

var roi = roiPA.geometry().dissolve(ee.ErrorMargin(1));

Map.centerObject(roi, 10);
```

**Parámetros:**
- **`WDPA.filter(ee.Filter.eq('NAME', 'Chingaza'))`**: Selecciona, dentro de la Base de Datos Mundial de Áreas Protegidas, el polígono (o polígonos) cuyo atributo `NAME` coincide exactamente con `'Chingaza'`. El resultado es una `FeatureCollection`, no una geometría única.
- **`roiPA.geometry().dissolve(ee.ErrorMargin(1))`**: `.geometry()` extrae la forma geográfica de la `FeatureCollection`; `.dissolve()` unifica todos sus polígonos en una sola geometría continua (relevante si el área protegida está registrada como varios fragmentos en la WDPA), usando `ee.ErrorMargin(1)` (1 metro) como tolerancia de simplificación en la disolución.
- **`Map.centerObject(roi, 10)`**: Centra el visor de mapa sobre el ROI. El segundo argumento (10) es el nivel de zoom inicial.
- **Nota técnica:** en el bloque de código tal como está, la primera línea asigna el resultado del filtro a `var roi`, pero la segunda línea lee `roiPA` (una variable no declarada) para construir la geometría disuelta. Para que el script corra sin error, la primera línea debe declarar `var roiPA = WDPA.filter(...)` en vez de `var roi = ...`. Con esa corrección, `roiPA` conserva la `FeatureCollection` original (útil para visualizar en el mapa con sus atributos), mientras que `roi` queda como la geometría ya disuelta, que es la que se usa en todos los cálculos de intersección y área de los pasos siguientes.

## Paso 2: Crear la función para calcular área por categoría

Definir `calcularAreaPorCategoria()`, que recibe cualquier colección de ecosistemas, el ROI, el nombre del campo de categoría (varía según el dataset) y el nombre que tendrá esa categoría en el resultado final. La función recorta cada polígono al ROI, calcula su área en hectáreas, descarta fragmentos menores a 0.1 ha, y agrupa/suma las áreas por categoría en un solo paso usando `reduceColumns()`.

```javascript
function calcularAreaPorCategoria(coleccion, roiGeom, campoCategoria, nombreSalida) {
  var conArea = coleccion.filterBounds(roiGeom).map(function(feature) {
    var interseccion = feature.geometry().intersection(roiGeom, ee.ErrorMargin(1));
    var areaHa = interseccion.area(ee.ErrorMargin(1)).divide(10000);
    return feature.set('Area_Ha', areaHa)
                  .set('Categoria', feature.get(campoCategoria));
  }).filter(ee.Filter.gt('Area_Ha', 0.1));

  var agrupado = conArea.reduceColumns({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'Categoria'}),
    selectors: ['Area_Ha', 'Categoria']
  });

  return ee.FeatureCollection(
    ee.List(agrupado.get('groups')).map(function(g) {
      g = ee.Dictionary(g);
      var props = {'Area_Total_Ha': g.get('sum')};
      props[nombreSalida] = g.get('Categoria');
      return ee.Feature(null, props);
    })
  );
}
```

**Parámetros de entrada de la función:**
- **`coleccion`**: la `FeatureCollection` de ecosistemas a analizar (por ejemplo, IUCN o Colombia).
- **`roiGeom`**: la geometría del área de interés (por ejemplo, Chingaza).
- **`campoCategoria`**: el nombre del campo que identifica el tipo de ecosistema en esa colección específica (por ejemplo, `'efg_code'` para IUCN, `'ecos_gener'` para Colombia — hay que revisarlo en cada dataset, porque no es un nombre estandarizado entre fuentes).
- **`nombreSalida`**: el nombre que va a tener esa categoría en el resultado final (por ejemplo, `'EFG_Code'`, `'Ecos_Gener'`).

**Parámetros del cuerpo de la función:**
- **`coleccion.filterBounds(roiGeom)`**: Descarta de entrada los polígonos que no intersectan el ROI, para no procesar ecosistemas irrelevantes en el resto de la función.
- **`feature.geometry().intersection(roiGeom, ee.ErrorMargin(1))`**: Recorta cada polígono de ecosistema exactamente al límite del ROI (no a su rectángulo envolvente), devolviendo solo la porción que realmente cae dentro. `ee.ErrorMargin(1)` es la tolerancia de simplificación (1 metro) permitida en la operación geométrica.
- **`interseccion.area(ee.ErrorMargin(1)).divide(10000)`**: Calcula el área de esa intersección en m² y la convierte a hectáreas (1 ha = 10 000 m²).
- **`feature.set('Area_Ha', areaHa).set('Categoria', feature.get(campoCategoria))`**: Agrega dos propiedades nuevas a cada feature: el área recortada en hectáreas, y una copia del valor de categoría bajo un nombre común (`'Categoria'`), independientemente de cómo se llame el campo original en cada dataset. Esto es lo que permite que la función sea reutilizable entre fuentes distintas.
- **`.filter(ee.Filter.gt('Area_Ha', 0.1))`**: Descarta fragmentos de intersección menores a 0.1 ha, típicamente artefactos de borde (tiras muy delgadas donde dos polígonos casi se tocan) que no representan ecosistema real y solo agregarían ruido a la suma.
- **`conArea.reduceColumns({ reducer: ee.Reducer.sum().group({...}), selectors: [...] })`**: Agrupa y suma en una sola operación: en vez de sumar toda la colección de una vez, `.group({groupField: 1, groupName: 'Categoria'})` hace que la suma se calcule por separado para cada valor distinto de la segunda columna indicada en `selectors` (`'Categoria'`, índice 1). `selectors: ['Area_Ha', 'Categoria']` define qué dos columnas de la tabla se le pasan al reducer, y en qué orden (el orden importa: `groupField: 1` apunta al índice de `'Categoria'` dentro de esa lista).
- **`agrupado.get('groups')`**: El resultado de un reducer agrupado es un diccionario con la clave `'groups'`, cuyo valor es una lista de diccionarios `{Categoria: <valor>, sum: <suma>}`, uno por cada categoría encontrada.
- **`ee.List(...).map(function(g){...})`**: Recorre esa lista de grupos y reconstruye, por cada uno, un `ee.Feature` sin geometría (`null`) con dos propiedades: `Area_Total_Ha` (la suma) y una propiedad cuyo nombre es dinámico (`props[nombreSalida] = ...`), tomado del parámetro de entrada de la función. Así, la misma función puede devolver una columna llamada `'EFG_Code'` o `'Ecos_Gener'` según qué dataset se le pase.

## Paso 3: Calcular las estadísticas del mapa global de la IUCN

Se aplica la función del Paso 2 a la colección de la IUCN, usando `'efg_code'` como campo de categoría.

```javascript
var typologyFC = ee.FeatureCollection("IUCN/GlobalEcosystemTypology/current");
var statsUnificadas = calcularAreaPorCategoria(typologyFC, roi, 'efg_code', 'EFG_Code');
```

**Parámetros:**
- **`ee.FeatureCollection("IUCN/GlobalEcosystemTypology/current")`**: Carga la colección global de la Tipología de Ecosistemas de la IUCN, que cubre todo el planeta (no solo el ROI); por eso `calcularAreaPorCategoria` empieza filtrando por `roiGeom` antes de cualquier otro cálculo.
- **`calcularAreaPorCategoria(typologyFC, roi, 'efg_code', 'EFG_Code')`**: Llama a la función del Paso 2 con la colección IUCN, el ROI disuelto, `'efg_code'` como campo de categoría propio de este dataset (el código de tipo de ecosistema funcional, según el esquema de la IUCN), y `'EFG_Code'` como nombre de columna en el resultado final.

**Opcional — tabla de resultados en consola:**

```javascript
var tablaChart = ui.Chart.feature.byFeature({
  features: statsUnificadas,
  xProperty: 'EFG_Code',
  yProperties: ['Area_Total_Ha']
}).setChartType('Table');

print(tablaChart);
```

- **`ui.Chart.feature.byFeature({ features, xProperty, yProperties })`**: Construye un gráfico (acá, una tabla) a partir de una `FeatureCollection`. `features` es la colección de origen; `xProperty` (`'EFG_Code'`) define la columna de agrupación; `yProperties` es una lista de columnas de valor a mostrar (acá, solo `'Area_Total_Ha'`).
- **`.setChartType('Table')`**: En vez de un gráfico de barras o líneas, renderiza el resultado como una tabla simple en la consola, más apropiada para revisar valores exactos categoría por categoría.

## Paso 4: Visualización — ecosistemas IUCN interceptados, coloreados por categoría

Se colorea cada polígono de ecosistema IUCN dentro del ROI según su código `efg_code`, usando una paleta fija de colores por categoría, y se agrega una leyenda dinámica que solo muestra los códigos efectivamente presentes en el AOI. Basado en el ejemplo de la [documentación oficial del dataset](https://developers.google.com/earth-engine/datasets/catalog/IUCN_GlobalEcosystemTypology_current?hl=es-419).

```javascript
var ecosystemTypology =
    ee.FeatureCollection('IUCN/GlobalEcosystemTypology/current');

var propertyToFilter = 'efg_code';

var labelsAndColorsClient = {
  'F1.1': '7e3fe6', 'F1.2': '77b3fd', 'F1.3': '7b8347', 'F1.4': 'fa6811',
  'F1.5': '965e6e', 'F1.6': 'd595dc', 'F1.7': '2f14df', 'F2.1': '224730',
  'F2.10': '2f6323', 'F2.2': 'ea36a3', 'F2.3': 'b2fc44', 'F2.4': 'c2318a',
  'F2.5': '6f243e', 'F2.6': 'ad10a8', 'F2.7': '6a4210', 'F2.8': '839347',
  'F2.9': '118b94', 'F3.1': 'cb3855', 'F3.2': 'd2b776', 'F3.3': 'ff72ed',
  'F3.4': '377e85', 'F3.5': '3fa71f', 'FM1.1': '10e167', 'FM1.2': '4e6fca',
  'FM1.3': '858536', 'M1.1': '141076', 'M1.10': 'a6067b', 'M1.2': '663dbc',
  'M1.3': '850c23', 'M1.4': 'aa2923', 'M1.5': '937e3c', 'M1.6': 'f1ecae',
  'M1.7': 'ba931f', 'M1.8': '023405', 'M1.9': 'ed5a09', 'M2.1': '354a2a',
  'M2.2': '8239cf', 'M2.3': '73b3cc', 'M2.4': 'be48b2', 'M2.5': 'c4897c',
  'M3.1': '68a571', 'M3.2': '69197d', 'M3.3': 'e22319', 'M3.4': '40b73a',
  'M3.5': 'caf10c', 'M3.6': '762197', 'M3.7': '91b06a', 'M4.1': '91c173',
  'M4.2': 'e1ea4a', 'MFT1.1': '9a1e2d', 'MFT1.2': '22aeda', 'MFT1.3': 'f0ae6e',
  'MT1.1': '1b96de', 'MT1.2': 'ea9e91', 'MT1.3': '0c9494', 'MT1.4': '436836',
  'MT2.1': '3478ff', 'MT2.2': 'e6233f', 'MT3.1': '0936c9', 'S1.1': '9d7488',
  'S2.1': 'ea1bee', 'SF1.1': '231e5f', 'SF1.2': 'f4cc74', 'SF2.1': 'fb0986',
  'SF2.2': 'fb9bce', 'SM1.1': '0d3303', 'SM1.2': '9964a5', 'SM1.3': 'f88d38',
  'T1.1': '048045', 'T1.2': 'ac86c0', 'T1.4': '0e19a9', 'T2.1': 'bc0383',
  'T2.2': '965eed', 'T2.3': '7d951f', 'T2.4': 'd98c15', 'T2.5': 'f1abff',
  'T2.6': 'be7214', 'T3.1': 'b03750', 'T3.2': 'e74d19', 'T3.3': '696ec3',
  'T3.4': 'fbb043', 'T4.1': '5b06be', 'T4.2': '583d4f', 'T4.3': 'edfc30',
  'T4.4': 'f32748', 'T4.5': '363f08', 'T5.1': 'e6891c', 'T5.2': '032bc5',
  'T5.3': '8daed3', 'T5.4': 'b359cb', 'T5.5': '8b5536', 'T6.1': '3d8857',
  'T6.2': 'e87587', 'T6.3': '8336b8', 'T6.4': 'fa8a1b', 'T6.5': '7427f1',
  'T7.1': '7d29a9', 'T7.2': '566e14', 'T7.3': 'f4bf4a', 'T7.4': 'fc2a94',
  'T7.5': '0e6040', 'TF1.1': 'e0b4cc', 'TF1.2': '5aabbc', 'TF1.3': '63f039',
  'TF1.4': 'ec6bdb', 'TF1.5': 'f786ec', 'TF1.6': '00b9f4', 'TF1.7': '77d71d',
  'T1.3': 'ffffff'
};
var labelsAndColors = ee.Dictionary(labelsAndColorsClient);

// Filtrar primero por el ROI, no solo por 'efg_code' no nulo.
// Esto reduce el procesamiento a solo los polígonos dentro de Chingaza.
var filteredEcosystems = ecosystemTypology
  .filterBounds(roi)
  .filter(ee.Filter.neq(propertyToFilter, null));

// Aplicar 'color' (borde) y 'fillColor' con opacidad por separado,
// para que se vean los límites de cada polígono y no se vea "plano".
var image = filteredEcosystems
  .map(function (feature) {
    var colorHex = labelsAndColors.get(feature.get('efg_code'));
    return feature.set('efgStyle', {
      'color': '000000',           // borde negro para distinguir polígonos
      'fillColor': ee.String(colorHex).cat('B3'), // 'B3' ≈ 70% opacidad en hex
      'width': 1
    });
  })
  .style({
    'styleProperty': 'efgStyle',
  });

Map.addLayer(image, {}, 'Ecosistemas IUCN en Chingaza');
Map.centerObject(roi, 10);

// =========================================================================
// Leyenda dinámica — solo con los códigos presentes en el ROI
// =========================================================================
var codigosPresentes = filteredEcosystems.aggregate_array('efg_code').distinct();

codigosPresentes.evaluate(function(codigos) {
  var leyenda = ui.Panel({
    style: {position: 'bottom-left', padding: '8px 15px'}
  });

  leyenda.add(ui.Label({
    value: 'Ecosistemas IUCN (Chingaza)',
    style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 6px 0'}
  }));

  codigos.sort().forEach(function(codigo) {
    var colorHex = labelsAndColorsClient[codigo] || 'cccccc';
    var colorBox = ui.Label({
      style: {
        backgroundColor: '#' + colorHex,
        padding: '8px',
        margin: '2px 6px 2px 0'
      }
    });
    var descripcion = ui.Label({
      value: codigo,
      style: {margin: '2px 0'}
    });
    leyenda.add(ui.Panel({
      widgets: [colorBox, descripcion],
      layout: ui.Panel.Layout.Flow('horizontal')
    }));
  });

  Map.add(leyenda);
});

Map.addLayer(roi, {color: 'green', opacity: 0.5}, 'Áreas Protegidas Seleccionadas');
```

**Parámetros:**
- **`labelsAndColorsClient`**: Diccionario de JavaScript plano (del lado del cliente, no de GEE) que asigna un color hexadecimal fijo a cada código de ecosistema `efg_code` posible en la tipología IUCN. Mantenerlo como objeto de JavaScript (no como `ee.Dictionary` desde el inicio) permite reutilizarlo directamente en la leyenda, que corre en el cliente.
- **`labelsAndColors = ee.Dictionary(labelsAndColorsClient)`**: Versión del mismo diccionario convertida a `ee.Dictionary`, necesaria para poder usar `.get()` dentro de un `.map()` sobre una `FeatureCollection`, que se ejecuta del lado del servidor.
- **`ecosystemTypology.filterBounds(roi).filter(ee.Filter.neq(propertyToFilter, null))`**: Primero descarta los polígonos fuera del ROI (reduciendo drásticamente el volumen a procesar), y luego descarta los que no tienen valor en `'efg_code'`. Hacer el filtro espacial primero es importante por rendimiento: filtrar por atributo sobre la colección global completa sería mucho más lento.
- **`feature.set('efgStyle', {...})`**: En vez de pintar todo con un solo color, se le asigna a cada feature un diccionario de estilo propio (`efgStyle`) con su color de borde, color de relleno y grosor de línea, calculado a partir de su propio `efg_code`.
- **`ee.String(colorHex).cat('B3')`**: Concatena el sufijo hexadecimal `'B3'` (aproximadamente 70% de opacidad en notación ARGB de 8 dígitos) al color base, para que el relleno sea semitransparente y no oculte por completo las capas debajo.
- **`.style({ styleProperty: 'efgStyle' })`**: Renderiza la `FeatureCollection` como una imagen, tomando el estilo de cada feature individual desde la propiedad indicada (`'efgStyle'`), en vez de aplicar un único `visParams` global a toda la colección — es lo que permite que cada polígono tenga su propio color según su categoría.
- **`Map.addLayer(image, {}, 'Ecosistemas IUCN en Chingaza')`**: Agrega la imagen ya estilizada al mapa. El objeto de estilo va vacío (`{}`) porque el estilo real ya está "horneado" en la imagen por `.style()`.
- **`filteredEcosystems.aggregate_array('efg_code').distinct()`**: Extrae, como lista, todos los valores de `efg_code` presentes en el ROI, sin duplicados. Es la base de la leyenda dinámica: solo van a aparecer ahí los códigos que realmente existen dentro de Chingaza, no los ~100 códigos de la paleta completa.
- **`codigosPresentes.evaluate(function(codigos){...})`**: `.evaluate()` trae el resultado (la lista de códigos) del servidor al cliente de forma asíncrona, y ejecuta la función de callback una vez que el valor está disponible. Es necesario porque construir la interfaz de la leyenda (`ui.Panel`, `ui.Label`) requiere valores concretos de JavaScript, no objetos `ee.List` del lado del servidor.
- **`ui.Panel({ style: { position: 'bottom-left', ... } })`**: Crea el contenedor visual de la leyenda, anclado en la esquina inferior izquierda del mapa.
- **`codigos.sort().forEach(function(codigo){...})`**: Recorre los códigos presentes en orden alfabético y agrega, por cada uno, una fila a la leyenda con un cuadro de color (`colorBox`) y una etiqueta de texto (`descripcion`).
- **`labelsAndColorsClient[codigo] || 'cccccc'`**: Busca el color del código en el diccionario del cliente; si por algún motivo un código no estuviera en la paleta predefinida, usa gris claro (`'cccccc'`) como color de respaldo en vez de fallar.
- **`ui.Panel({ widgets: [colorBox, descripcion], layout: ui.Panel.Layout.Flow('horizontal') })`**: Organiza el cuadro de color y el texto en una misma fila horizontal, en vez de apilarlos verticalmente.
- **`Map.add(leyenda)`**: Agrega el panel de leyenda ya construido al visor de mapa (distinto de `Map.addLayer`, que agrega capas geográficas; `Map.add` agrega elementos de interfaz).
- **`Map.addLayer(roi, {color: 'green', opacity: 0.5}, 'Áreas Protegidas Seleccionadas')`**: Agrega el contorno del ROI en verde semitransparente, como referencia visual sobre los ecosistemas coloreados.

## Paso 5: Cálculo de áreas — mapa nacional de ecosistemas de Colombia

Se repite el cálculo de área por categoría del Paso 2, ahora sobre el mapa de ecosistemas de Colombia, usando `'ecos_gener'` como campo de categoría propio de ese dataset.

```javascript
var colMapFC = ee.FeatureCollection("projects/ee-paulapaz1101/assets/biodiversity_workshop/GEODATA/ecosystem_map_COL");
var statsUnificadas_COL = calcularAreaPorCategoria(colMapFC, roi, 'ecos_gener', 'Ecos_Gener');
```

**Parámetros:**
- **`ee.FeatureCollection("projects/.../ecosystem_map_COL")`**: Carga el mapa nacional de ecosistemas de Colombia como asset del proyecto (no un dataset público del catálogo de GEE), por lo que requiere que el usuario tenga acceso a ese proyecto específico.
- **`calcularAreaPorCategoria(colMapFC, roi, 'ecos_gener', 'Ecos_Gener')`**: Misma función reutilizable del Paso 2, aplicada ahora al mapa de Colombia. El campo de categoría cambia a `'ecos_gener'` (el nombre real de la columna en este dataset, distinto de `'efg_code'` de la IUCN), y el nombre de salida a `'Ecos_Gener'`. Esta es la razón por la que la función se diseñó con `campoCategoria` y `nombreSalida` como parámetros: cada fuente de ecosistemas usa su propio esquema de nombres de columna.

**Opcional — tabla de resultados en consola:**

```javascript
var tablaChart_COL = ui.Chart.feature.byFeature({
  features: statsUnificadas_COL,
  xProperty: 'Ecos_Gener',
  yProperties: ['Area_Total_Ha']
}).setChartType('Table');
print('Tabla Colombia', tablaChart_COL);
```

- Misma lógica que la tabla del Paso 3, aplicada a `statsUnificadas_COL` y usando `'Ecos_Gener'` como columna de agrupación.

**Opcional — exportar las estadísticas de Colombia a Google Drive:**

```javascript
Export.table.toDrive({
  collection: statsUnificadas_COL,
  description: 'Chingaza_Estadisticas_Mapa_Colombia',
  fileFormat: 'CSV',
  selectors: ['Ecos_Gener', 'Area_Total_Ha']
});
```

- **`Export.table.toDrive({...})`**: Genera una tarea de exportación de una tabla a Google Drive. La tarea queda pendiente en la pestaña "Tasks" del editor y debe iniciarse manualmente (botón "Run").
- **`collection: statsUnificadas_COL`**: La `FeatureCollection` de resultados a exportar.
- **`description`**: Nombre de la tarea y, por defecto, del archivo CSV resultante.
- **`selectors: ['Ecos_Gener', 'Area_Total_Ha']`**: Limita las columnas exportadas a solo estas dos, evitando arrastrar columnas intermedias (como `'Categoria'`) que no aportan valor en el archivo final.

**Opcional — visualizar el mapa de ecosistemas de Colombia:**

```javascript
Map.addLayer(colMapFC, {}, 'Mapa de Ecosistemas Colombia (Chingaza)', true);
```

- **`Map.addLayer(colMapFC, {}, ..., true)`**: Agrega la colección completa de Colombia al mapa sin estilo por categoría (`{}`, a diferencia del estilizado por `efgStyle` del Paso 4), visible por defecto (`true`). Útil como referencia rápida, aunque no diferencia colores por tipo de ecosistema.

**Código completo:** Script `04_Área_GlobalEcosystemTypology` del repositorio, carpeta `day_1`, o enlace directo: [https://code.earthengine.google.com/921e379df7db059ea8cc3cc11c31288a?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop](https://code.earthengine.google.com/921e379df7db059ea8cc3cc11c31288a?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop)

<!-- ## Paso a paso

### Paso 1: Definir el área de interés
Cargar la colección de áreas protegidas (`WCMC/WDPA/current/polygons`) y filtrarla con `ee.Filter.eq()` para obtener el polígono correspondiente al Parque Nacional Chingaza. Centrar el mapa sobre el resultado.

```javascript
var WDPA = ee.FeatureCollection("WCMC/WDPA/current/polygons");
var roi = WDPA.filter(
  ee.Filter.eq('NAME', 'Chingaza'));

var roi = roiPA.geometry().dissolve(ee.ErrorMargin(1));

Map.centerObject(roi, 10);
```

<!-- > **Nota técnica:** aquí `roi` es una `FeatureCollection` (puede contener más de un polígono si el área protegida está dividida en varias partes). Si más adelante notas inconsistencias en los cálculos de área, considera usar `roi.geometry().dissolve()` para trabajar con una única geometría unificada en las funciones de intersección. -->

**Nota técnica:** `roiPA` conserva la `FeatureCollection` original (útil para visualizar en el mapa con sus atributos), mientras que `roi` es la geometría ya disuelta, que es la que se va usar en todos los cálculos de intersección y área más adelante. 

### Paso 2: Crear la función para calcular área por categoría

Definir `calcularAreaPorCategoria()`, que recibe cualquier colección de ecosistemas, el ROI, el nombre del campo de categoría (varía según el dataset) y el nombre que tendrá esa categoría en el resultado final. La función recorta cada polígono al ROI, calcula su área en hectáreas, descarta fragmentos menores a 0.1 ha, y agrupa/suma las áreas por categoría en un solo paso usando `reduceColumns()`.

# Parámetros de entrada:
- coleccion: la FeatureCollection de ecosistemas a analizar (ej. IUCN o Colombia).
- roiGeom: la geometría del área de interés (ej. Chingaza).
- campoCategoria: el nombre del campo que identifica el tipo de ecosistema en esa colección específica (ej. 'efg_code' para IUCN, 'ecos_gener' para Colombia - revisar en cada dataset).
- nombreSalida: el nombre que quieres que tenga esa categoría en el resultado final (ej. 'EFG_Code', 'Ecos_Gener').

Función parte 1:
a.calcula área de cada polígono individual que se sobrepone en ROI
b.  calcula el área  en m2 y convierte el valor en ha
Retorna: área, categoria 


```javascript
function calcularAreaPorCategoria(coleccion, roiGeom, campoCategoria, nombreSalida) {
  var conArea = coleccion.filterBounds(roiGeom).map(function(feature) {
    var interseccion = feature.geometry().intersection(roiGeom, ee.ErrorMargin(1));
    var areaHa = interseccion.area(ee.ErrorMargin(1)).divide(10000);
    return feature.set('Area_Ha', areaHa)
                  .set('Categoria', feature.get(campoCategoria));
  }).filter(ee.Filter.gt('Area_Ha', 0.1));

  var agrupado = conArea.reduceColumns({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'Categoria'}),
    selectors: ['Area_Ha', 'Categoria']
  });

  return ee.FeatureCollection(
    ee.List(agrupado.get('groups')).map(function(g) {
      g = ee.Dictionary(g);
      var props = {'Area_Total_Ha': g.get('sum')};
      props[nombreSalida] = g.get('Categoria');
      return ee.Feature(null, props);
    })
  );
}
```

### Paso 3: Calcular las estadísticas del mapa global de la IUCN

```javascript
var typologyFC = ee.FeatureCollection("IUCN/GlobalEcosystemTypology/current");
var statsUnificadas = calcularAreaPorCategoria(typologyFC, roi, 'efg_code', 'EFG_Code');
```

### Opcional:
Gráficas resultados en tabla con columnas ['EFG_Code'] y ['Area_Total_Ha']

```javascript
var tablaChart = ui.Chart.feature.byFeature({
  features: statsUnificadas,
  xProperty: 'EFG_Code',
  yProperties: ['Area_Total_Ha']
}).setChartType('Table');

print(tablaChart);
```

### Paso 4: Visualización: Ecosistemas IUCN interceptados, coloreados por categoría
Tomado de [https://developers.google.com/earth-engine/datasets/catalog/IUCN_GlobalEcosystemTypology_current?hl=es-419](https://developers.google.com/earth-engine/datasets/catalog/IUCN_GlobalEcosystemTypology_current?hl=es-419)

```javascript
var ecosystemTypology =
    ee.FeatureCollection('IUCN/GlobalEcosystemTypology/current');

var propertyToFilter = 'efg_code';

var labelsAndColorsClient = {
  'F1.1': '7e3fe6', 'F1.2': '77b3fd', 'F1.3': '7b8347', 'F1.4': 'fa6811',
  'F1.5': '965e6e', 'F1.6': 'd595dc', 'F1.7': '2f14df', 'F2.1': '224730',
  'F2.10': '2f6323', 'F2.2': 'ea36a3', 'F2.3': 'b2fc44', 'F2.4': 'c2318a',
  'F2.5': '6f243e', 'F2.6': 'ad10a8', 'F2.7': '6a4210', 'F2.8': '839347',
  'F2.9': '118b94', 'F3.1': 'cb3855', 'F3.2': 'd2b776', 'F3.3': 'ff72ed',
  'F3.4': '377e85', 'F3.5': '3fa71f', 'FM1.1': '10e167', 'FM1.2': '4e6fca',
  'FM1.3': '858536', 'M1.1': '141076', 'M1.10': 'a6067b', 'M1.2': '663dbc',
  'M1.3': '850c23', 'M1.4': 'aa2923', 'M1.5': '937e3c', 'M1.6': 'f1ecae',
  'M1.7': 'ba931f', 'M1.8': '023405', 'M1.9': 'ed5a09', 'M2.1': '354a2a',
  'M2.2': '8239cf', 'M2.3': '73b3cc', 'M2.4': 'be48b2', 'M2.5': 'c4897c',
  'M3.1': '68a571', 'M3.2': '69197d', 'M3.3': 'e22319', 'M3.4': '40b73a',
  'M3.5': 'caf10c', 'M3.6': '762197', 'M3.7': '91b06a', 'M4.1': '91c173',
  'M4.2': 'e1ea4a', 'MFT1.1': '9a1e2d', 'MFT1.2': '22aeda', 'MFT1.3': 'f0ae6e',
  'MT1.1': '1b96de', 'MT1.2': 'ea9e91', 'MT1.3': '0c9494', 'MT1.4': '436836',
  'MT2.1': '3478ff', 'MT2.2': 'e6233f', 'MT3.1': '0936c9', 'S1.1': '9d7488',
  'S2.1': 'ea1bee', 'SF1.1': '231e5f', 'SF1.2': 'f4cc74', 'SF2.1': 'fb0986',
  'SF2.2': 'fb9bce', 'SM1.1': '0d3303', 'SM1.2': '9964a5', 'SM1.3': 'f88d38',
  'T1.1': '048045', 'T1.2': 'ac86c0', 'T1.4': '0e19a9', 'T2.1': 'bc0383',
  'T2.2': '965eed', 'T2.3': '7d951f', 'T2.4': 'd98c15', 'T2.5': 'f1abff',
  'T2.6': 'be7214', 'T3.1': 'b03750', 'T3.2': 'e74d19', 'T3.3': '696ec3',
  'T3.4': 'fbb043', 'T4.1': '5b06be', 'T4.2': '583d4f', 'T4.3': 'edfc30',
  'T4.4': 'f32748', 'T4.5': '363f08', 'T5.1': 'e6891c', 'T5.2': '032bc5',
  'T5.3': '8daed3', 'T5.4': 'b359cb', 'T5.5': '8b5536', 'T6.1': '3d8857',
  'T6.2': 'e87587', 'T6.3': '8336b8', 'T6.4': 'fa8a1b', 'T6.5': '7427f1',
  'T7.1': '7d29a9', 'T7.2': '566e14', 'T7.3': 'f4bf4a', 'T7.4': 'fc2a94',
  'T7.5': '0e6040', 'TF1.1': 'e0b4cc', 'TF1.2': '5aabbc', 'TF1.3': '63f039',
  'TF1.4': 'ec6bdb', 'TF1.5': 'f786ec', 'TF1.6': '00b9f4', 'TF1.7': '77d71d',
  'T1.3': 'ffffff'
};
var labelsAndColors = ee.Dictionary(labelsAndColorsClient);

// Filtrar primero por el ROI, no solo por 'efg_code' no nulo.
// Esto reduce el procesamiento a solo los polígonos dentro de Chingaza.
var filteredEcosystems = ecosystemTypology
  .filterBounds(roi)
  .filter(ee.Filter.neq(propertyToFilter, null));

// Aplicar 'color' (borde) y 'fillColor' con opacidad por separado,
// para que se vean los límites de cada polígono y no se vea "plano".
var image = filteredEcosystems
  .map(function (feature) {
    var colorHex = labelsAndColors.get(feature.get('efg_code'));
    return feature.set('efgStyle', {
      'color': '000000',           // borde negro para distinguir polígonos
      'fillColor': ee.String(colorHex).cat('B3'), // 'B3' ≈ 70% opacidad en hex
      'width': 1
    });
  })
  .style({
    'styleProperty': 'efgStyle',
  });

Map.addLayer(image, {}, 'Ecosistemas IUCN en Chingaza');
Map.centerObject(roi, 10); // 

// =========================================================================
// Leyenda dinámica — solo con los códigos presentes en el ROI
// =========================================================================
var codigosPresentes = filteredEcosystems.aggregate_array('efg_code').distinct();

codigosPresentes.evaluate(function(codigos) {
  var leyenda = ui.Panel({
    style: {position: 'bottom-left', padding: '8px 15px'}
  });

  leyenda.add(ui.Label({
    value: 'Ecosistemas IUCN (Chingaza)',
    style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 6px 0'}
  }));

  codigos.sort().forEach(function(codigo) {
    var colorHex = labelsAndColorsClient[codigo] || 'cccccc';
    var colorBox = ui.Label({
      style: {
        backgroundColor: '#' + colorHex,
        padding: '8px',
        margin: '2px 6px 2px 0'
      }
    });
    var descripcion = ui.Label({
      value: codigo,
      style: {margin: '2px 0'}
    });
    leyenda.add(ui.Panel({
      widgets: [colorBox, descripcion],
      layout: ui.Panel.Layout.Flow('horizontal')
    }));
  });

  Map.add(leyenda);
});

Map.addLayer(roi, {color: 'green', opacity: 0.5}, 'Áreas Protegidas Seleccionadas');
``` 

### Paso 5 : CÁLCULO DE ÁREAS: MAPA NACIONAL DE ECOSISTEMAS DE COLOMBIA

```javascript
var colMapFC = ee.FeatureCollection("projects/ee-paulapaz1101/assets/biodiversity_workshop/GEODATA/ecosystem_map_COL");
var statsUnificadas_COL = calcularAreaPorCategoria(colMapFC, roi, 'ecos_gener', 'Ecos_Gener');
```

### Opcional: Visualizar la tabla de resultados de Colombia

```javascript
var tablaChart_COL = ui.Chart.feature.byFeature({
  features: statsUnificadas_COL,
  xProperty: 'Ecos_Gener',
  yProperties: ['Area_Total_Ha']
}).setChartType('Table');
print('Tabla Colombia', tablaChart_COL);
```

### Opcional: Exportar las estadísticas de Colombia a Google Drive

```javascript
Export.table.toDrive({
  collection: statsUnificadas_COL,
  description: 'Chingaza_Estadisticas_Mapa_Colombia',
  fileFormat: 'CSV',
  selectors: ['Ecos_Gener', 'Area_Total_Ha']
});
```

### Opcional: Visualizar el mapa de ecosistemas de Colombia (opcional)

```javascript
Map.addLayer(colMapFC, {}, 'Mapa de Ecosistemas Colombia (Chingaza)', true);
```

### Código completo
Script "`04_Área_GlobalEcosystemTypology`" del repositorio y la carpeta `day_1` o link directo:
[https://code.earthengine.google.com/921e379df7db059ea8cc3cc11c31288a?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop](https://code.earthengine.google.com/921e379df7db059ea8cc3cc11c31288a?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop) -->