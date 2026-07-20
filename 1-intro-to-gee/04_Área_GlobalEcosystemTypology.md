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

### Visualización: Ecosistemas IUCN interceptados, coloreados por categoría
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
