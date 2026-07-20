---
layout: page
title: 01_Change_Detection_Embeddings
parent: "Introducción a Embedding"
nav_order: 3
---

## 01_Change_Detection_Embeddings

# Objetivos

Detectar pérdida de bosque dentro de un área de interés (AOI), comparando dos "resúmenes" anuales del terreno generados por un modelo de inteligencia artificial (embeddings satelitales de Google), restringidos a una máscara de bosque para distinguir pérdida de ganancia, y validar ese resultado contra un producto especializado e independiente de pérdida de cobertura forestal (Hansen Global Forest Change).

## Datos

- **`GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`** — Embeddings satelitales anuales (Google).<br>
Collection: `ee.ImageCollection("GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL")`
- **`ESA/WorldCover/v100/2020`** — Cobertura de la tierra, clase 10 = "Tree cover" (ESA WorldCover).<br>
Image: `ee.Image("ESA/WorldCover/v100/2020")`
- **`UMD/hansen/global_forest_change_2024_v1_12`** — Cambio de cobertura forestal (Hansen GFC).<br>
Image: `ee.Image("UMD/hansen/global_forest_change_2024_v1_12")`
- **`WCMC/WDPA/current/polygons`** — Base de Datos Mundial de Áreas Protegidas (WDPA), para el AOI a escala área protegida.<br>
Collection: `ee.FeatureCollection("WCMC/WDPA/current/polygons")`
- **`FAO/GAUL/2015/level0`** — Límites administrativos nacionales, para el AOI a escala país.<br>
Collection: `ee.FeatureCollection("FAO/GAUL/2015/level0")`

## Métodos

1. Embeddings satelitales y similitud por producto punto (coseno)
2. Máscara de cobertura de la tierra (rasterización de clase)
3. Álgebra de bandas y máscaras (updateMask, selfMask)
4. Reducción agrupada por región (reduceRegion, sum)
5. Validación cruzada entre dos métodos independientes

## Paso a paso
## Paso 1: Área de interés y AOI de proceso (con margen)

Se define el AOI de dos formas posibles (área protegida o país), y se genera una segunda versión de ese AOI, agrandada 500 m hacia afuera con .buffer(). Todo el análisis intermedio (Pasos 2 a 7) se ejecuta sobre esta versión agrandada; el AOI original solo se usa al final, para recortar resultados y calcular áreas.

```javascript
var WDPA = ee.FeatureCollection('WCMC/WDPA/current/polygons');
var GAUL0 = ee.FeatureCollection('FAO/GAUL/2015/level0');

var area = WDPA.filter(ee.Filter.eq('NAME', 'Chingaza'));

// var area = GAUL0.filter(ee.Filter.eq('ADM0_NAME', 'Colombia'));

var geometry = area.geometry();

var distanciaBufferProceso = 500;
var geometryProceso = geometry.buffer(distanciaBufferProceso);
```

**Parámetros:**
- **`WDPA.filter(ee.Filter.eq('NAME', 'Chingaza'))`**: Selecciona, dentro de la Base de Datos Mundial de Áreas Protegidas, el polígono cuyo atributo `NAME` coincide exactamente con `'Chingaza'`. Es la opción de AOI puntual (un parque).
- **`GAUL0.filter(ee.Filter.eq('ADM0_NAME', 'Colombia'))` (comentado)**: Alternativa de AOI a escala país: selecciona el polígono nacional cuyo atributo `ADM0_NAME` es `'Colombia'`. Solo una de las dos líneas `var area = ...` debe estar activa a la vez.
- **`area.geometry()`**: Extrae la forma geográfica (el polígono) del feature seleccionado; es lo que necesitan la mayoría de las funciones de GEE para recortar y filtrar.
- **`distanciaBufferProceso = 500`**: Distancia en metros que se usa para agrandar el AOI hacia afuera. 500 m es un margen razonable para el AOI de una sola área protegida.
- **`geometry.buffer(distanciaBufferProceso)`**: Genera un nuevo polígono que incluye al original más una franja de 500 m alrededor de todo su perímetro, evitando artefactos de borde en los cálculos que dependen de vecindad de píxeles (como `mosaic()` en tiles que cruzan el límite del AOI real).

## Paso 2: Cargar embeddings de los dos años a comparar

Se define una función reutilizable que arma la imagen de embeddings de un año determinado, ya recortada al AOI de proceso, y se aplica a los dos años que se van a comparar.

```javascript
var dataset = ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL');

var year1 = 2020; // año "antes"
var year2 = 2024; // año "después"

function obtenerEmbedding(anio) {
  return dataset
    .filterDate(anio + '-01-01', (anio + 1) + '-01-01')
    .filterBounds(geometryProceso)
    .mosaic()
    .clip(geometryProceso);
}

var image1 = obtenerEmbedding(year1);
var image2 = obtenerEmbedding(year2);
```

**Parámetros:**
- **`year1` / `year2`**: Los dos años que se van a comparar ("antes" y "después"). `year1` cumple además un segundo rol en este script: es el año de referencia de la máscara de bosque (Paso 4).
- **`dataset.filterDate(anio + '-01-01', (anio + 1) + '-01-01')`**: Filtra la colección para quedarse solo con la imagen correspondiente a un año calendario completo.
- **`.filterBounds(geometryProceso)`**: Descarta las tiles del dataset que no intersectan el AOI de proceso, para no procesar datos innecesarios.
- **`.mosaic()`**: Une en una sola imagen todas las tiles filtradas que tocan el AOI. Se usa `mosaic()` en lugar de `.first()` porque el AOI puede caer sobre más de una tile del dataset; con `.first()` podrían quedar huecos sin datos en la parte del AOI cubierta por una tile distinta a la primera.
- **`.clip(geometryProceso)`**: Recorta la imagen resultante al AOI agrandado.

## Paso 3: Calcular la similitud entre años

Se compara, píxel por píxel, el vector de embedding del año 1 contra el del año 2, para obtener un único valor de similitud por píxel. Este valor todavía no distingue pérdida de ganancia: eso se resuelve en el Paso 5, combinándolo con la máscara de bosque del Paso 4.

```javascript
var dotProd = image1.multiply(image2).reduce(ee.Reducer.sum())
  .rename('similitud');
```

**Parámetros:**
- **`image1.multiply(image2)`**: Multiplica, banda por banda (número por número dentro del vector de 64 valores), los embeddings de ambos años.
- **`.reduce(ee.Reducer.sum())`**: Suma los 64 valores resultantes en un solo número por píxel. Como los vectores de embedding tienen longitud 1, esta suma equivale al producto punto entre los dos vectores, que a su vez equivale al coseno del ángulo entre ellos: 1.0 = vectores idénticos (el píxel no cambió), 0.0 = vectores muy distintos (el píxel cambió mucho, sin importar si fue pérdida o ganancia).
- **`.rename('similitud')`**: Le da un nombre legible a la banda resultante.

## Paso 4: Máscara de bosque (ESA WorldCover 2020)

Se construye una máscara binaria que marca qué píxeles eran bosque en `year1`, usando ESA WorldCover 2020. Esta máscara es la pieza clave que permite convertir "cambio" en "pérdida": solo dentro de píxeles que empezaron siendo bosque, una baja similitud solo puede interpretarse como pérdida o degradación, nunca como ganancia.

```javascript
var worldCover2020 = ee.Image('ESA/WorldCover/v100/2020').select('Map');
var mascaraBosqueYear1 = worldCover2020.eq(10).clip(geometryProceso).rename('mascara_bosque_year1');
```

**Parámetros:**
- **`ee.Image('ESA/WorldCover/v100/2020').select('Map')`**: Carga la imagen global de cobertura de la tierra 2020 y selecciona la banda `'Map'`, que contiene el código numérico de clase de cobertura por píxel.
- **`worldCover2020.eq(10)`**: Genera una imagen booleana (1/0): 1 donde la clase de cobertura es exactamente 10 ("Tree cover" / cobertura arbórea), 0 en cualquier otra clase (cultivos, agua, urbano, pastizal, etc.).
- **`.clip(geometryProceso).rename('mascara_bosque_year1')`**: Recorta la máscara al AOI de proceso y le da un nombre descriptivo, dejándola lista para usarse tanto sobre la capa de embeddings (Paso 5) como sobre la de Hansen (Paso 6).

## Paso 5: Pérdida detectada, restringida a la máscara de bosque

Se aplica un umbral de similitud, pero el resultado se enmascara además con la capa de bosque del Paso 4, de modo que solo queden píxeles que (a) tuvieron baja similitud entre años, y (b) eran bosque en `year1`.

```javascript
var umbralSimilitud = 0.8;

var perdidaEmbeddings = dotProd.lt(umbralSimilitud)
  .updateMask(mascaraBosqueYear1)
  .selfMask()
  .rename('perdida_embeddings');
```

**Parámetros:**
- **`umbralSimilitud = 0.8`**: Valor de corte: los píxeles con similitud por debajo de 0.8 se consideran candidatos a pérdida. No existe un umbral universal válido para todos los ecosistemas; se recomienda ajustarlo revisando el histograma de la capa `'similitud'` dentro de zonas boscosas conocidas, y comparando visualmente contra imágenes Sentinel-2 antes de darlo por definitivo.
- **`dotProd.lt(umbralSimilitud)`**: Genera una imagen booleana: 1 donde la similitud es menor al umbral (candidato a pérdida), 0 donde es mayor o igual.
- **`.updateMask(mascaraBosqueYear1)`**: Este es el paso que distingue pérdida de ganancia: aplica la máscara de bosque del Paso 4, de forma que solo sobrevivan como "con dato" los píxeles candidatos que además eran bosque en `year1`. Un píxel que ganó vegetación (por ejemplo, de suelo desnudo a bosque) también tendría baja similitud, pero al no ser bosque en `year1` queda excluido aquí.
- **`.selfMask().rename('perdida_embeddings')`**: Oculta los píxeles en 0 (o sin dato tras la máscara de bosque), dejando visibles y medibles solo los píxeles de pérdida detectada, y nombra la banda resultante.

## Paso 6: Validar contra Hansen Global Forest Change

Se calcula, de forma independiente, dónde Hansen GFC reporta pérdida de bosque entre `year1` y `year2`, aplicando la misma máscara de bosque del Paso 4, para que ambos métodos busquen sobre exactamente el mismo dominio de bosque.

```javascript
var gfc = ee.Image('UMD/hansen/global_forest_change_2024_v1_12');
var lossAnioYear1 = year1 - 2000;
var lossAnioFin = year2 - 2000;

var perdidaBosqueBool = gfc.select('lossyear')
  .gte(lossAnioYear1 + 1) // pérdida ocurrida después de year1, misma ventana que perdidaEmbeddings
  .and(gfc.select('lossyear').lte(lossAnioFin))
  .and(mascaraBosqueYear1)
  .clip(geometryProceso);

var perdidaBosque = perdidaBosqueBool.selfMask().rename('perdida_bosque_hansen');
```

**Parámetros:**
- **`ee.Image('UMD/hansen/global_forest_change_2024_v1_12')`**: Carga la imagen global de Hansen GFC. Nota de versión: `2024_v1_12` es la versión vigente al momento de escribir esto (cubre pérdida hasta 2024); si `year2` avanza a un año más reciente, hay que actualizar el id del asset.
- **`lossAnioYear1` / `lossAnioFin`**: Convierten `year1` y `year2` al formato en que Hansen codifica los años en `'lossyear'` (año calendario menos 2000).
- **`.gte(lossAnioYear1 + 1)`**: Exige que el año de pérdida sea posterior a `year1` (no el mismo año), para que la ventana de búsqueda de Hansen coincida con la de los embeddings, que comparan `year1` contra `year2` y por lo tanto solo pueden capturar pérdida ocurrida después de `year1`.
- **`.and(gfc.select('lossyear').lte(lossAnioFin))`**: Limita el rango por arriba: el año de pérdida no puede ser posterior a `year2`.
- **`.and(mascaraBosqueYear1)`**: Aplica la misma máscara de bosque usada para los embeddings, en lugar de un filtro propio de cobertura arbórea de Hansen. Esto asegura que la comparación entre ambos métodos en el Paso 7 sea sobre el mismo universo de píxeles, y no una mezcla de dos definiciones distintas de "bosque".
- **`.clip(geometryProceso)`**: Recorta el resultado al AOI agrandado, igual que las demás capas intermedias.
- **`perdidaBosqueBool.selfMask().rename('perdida_bosque_hansen')`**: Genera la versión enmascarada (para visualización y medición de área), conservando la versión booleana sin enmascarar (`perdidaBosqueBool`) para el cálculo de coincidencia del Paso 7.

## Paso 7: Coincidencia entre ambos métodos

Se identifican los píxeles donde ambos métodos —embeddings restringidos a bosque y Hansen GFC— coinciden en marcar pérdida.

```javascript
var coincidencia = perdidaEmbeddings.multiply(perdidaBosqueBool)
  .selfMask()
  .rename('coincidencia');
```

**Parámetros:**
- **`perdidaEmbeddings.multiply(perdidaBosqueBool)`**: Multiplica dos capas booleanas (0/1): el resultado es 1 únicamente donde ambas valen 1 al mismo tiempo, y 0 en cualquier otro caso, incluyendo donde solo un método marca pérdida.
- **`.selfMask().rename('coincidencia')`**: Oculta los píxeles en 0 para poder visualizar y medir por separado únicamente el área de coincidencia real entre los dos métodos.

## Paso 8: Recortar al AOI original

Hasta este punto, todas las capas cubren el AOI agrandado (`geometryProceso`). Este es el único paso del script donde se vuelve al límite real del área de interés.

```javascript
var dotProdFinal = dotProd.clip(geometry);
var mascaraBosqueYear1Final = mascaraBosqueYear1.clip(geometry);
var perdidaEmbeddingsFinal = perdidaEmbeddings.clip(geometry);
var perdidaBosqueFinal = perdidaBosque.clip(geometry);
var coincidenciaFinal = coincidencia.clip(geometry);
```

**Parámetros:**
- **`.clip(geometry)`**: Recorta cada una de las cinco capas de resultado (similitud, máscara de bosque, pérdida por embeddings, pérdida Hansen, coincidencia) a la geometría original del AOI, descartando la franja de 500 m usada como margen de proceso. Este recorte no altera ningún valor calculado previamente: todos los cálculos anteriores son píxel a píxel y no dependen de dónde se ubique el límite de recorte.

## Paso 9: Visualización en el mapa

Se agregan al visor las capas de resultado ya recortadas al AOI original: la similitud continua (oculta por defecto), la máscara de bosque (oculta por defecto), la pérdida detectada por embeddings, la pérdida de Hansen, y la coincidencia entre ambos métodos.

```javascript
var visEmbeddings = {min: -0.3, max: 0.3, bands: ['A01', 'A16', 'A09']};
//Map.addLayer(image1.clip(geometry), visEmbeddings, 'Embeddings ' + year1, false);
//Map.addLayer(image2.clip(geometry), visEmbeddings, 'Embeddings ' + year2, false);

Map.addLayer(
  dotProdFinal,
  {min: 0, max: 1, palette: ['white', 'black']},
  'Similitud entre años (más oscuro = más distinto)',
  false
);

Map.addLayer(mascaraBosqueYear1Final, {palette: ['1a9850']}, 'Máscara de bosque (year1)', false);
Map.addLayer(perdidaEmbeddingsFinal, {palette: ['ff0000']}, 'Pérdida detectada (embeddings, dentro de bosque)');
Map.addLayer(perdidaBosqueFinal, {palette: ['ff8c00']}, 'Pérdida de bosque (Hansen GFC)');
Map.addLayer(coincidenciaFinal, {palette: ['ff00ff']}, 'Coincidencia embeddings + Hansen');
```

**Parámetros:**
- **`visEmbeddings = {min: -0.3, max: 0.3, bands: ['A01', 'A16', 'A09']}`**: Parámetros de visualización para ver los embeddings crudos como una imagen RGB "falsa". Las capas que usan esta paleta están comentadas por defecto.
- **`Map.addLayer(dotProdFinal, ..., false)`**: Muestra la similitud continua en escala de grises (blanco = idéntico, negro = muy distinto). El cuarto argumento `false` hace que la capa se agregue oculta por defecto, ya que en este script cumple un rol de apoyo/diagnóstico, no es el resultado principal.
- **`Map.addLayer(mascaraBosqueYear1Final, {palette: ['1a9850']}, ..., false)`**: Muestra en verde el dominio de bosque en `year1`, también oculta por defecto; es útil activarla para verificar visualmente que la máscara tiene sentido antes de confiar en los resultados de pérdida.
- **`Map.addLayer(perdidaEmbeddingsFinal, {palette: ['ff0000']}, ...)`**: Muestra en rojo, visible por defecto, los píxeles marcados como pérdida por el método de embeddings dentro de la máscara de bosque.
- **`Map.addLayer(perdidaBosqueFinal, {palette: ['ff8c00']}, ...)`**: Muestra en naranja los píxeles con pérdida de bosque según Hansen GFC, dentro de la misma máscara de bosque.
- **`Map.addLayer(coincidenciaFinal, {palette: ['ff00ff']}, ...)`**: Muestra en magenta los píxeles donde ambos métodos coinciden.

## Paso 10: Áreas y porcentajes de concordancia

Se calculan las áreas en hectáreas de cada capa de resultado, incluyendo el área total de bosque en `year1` (el dominio de búsqueda), y dos porcentajes de concordancia entre embeddings y Hansen. Todas las mediciones usan las capas ya recortadas al AOI original y el rectángulo envolvente de esa geometría.

```javascript
var areaPixelHa = ee.Image.pixelArea().divide(10000);

var parametrosArea = {
  reducer: ee.Reducer.sum(),
  geometry: geometry.bounds(),
  scale: 30,
  maxPixels: 1e13,
  bestEffort: true,
  tileScale: 8
};

var areaBosqueYear1Ha = areaPixelHa.updateMask(mascaraBosqueYear1Final)
  .reduceRegion(parametrosArea).get('area');
var areaPerdidaEmbeddingsHa = areaPixelHa.updateMask(perdidaEmbeddingsFinal)
  .reduceRegion(parametrosArea).get('area');
var areaPerdidaBosqueHa = areaPixelHa.updateMask(perdidaBosqueFinal)
  .reduceRegion(parametrosArea).get('area');
var areaCoincidenciaHa = areaPixelHa.updateMask(coincidenciaFinal)
  .reduceRegion(parametrosArea).get('area');

print('--- Pérdida de bosque: embeddings (restringido a máscara) vs Hansen GFC (' + year1 + '-' + year2 + ') ---');
print('Área de bosque en year1, dominio de búsqueda (ha):', areaBosqueYear1Ha);
print('Área con pérdida detectada por embeddings (ha):', areaPerdidaEmbeddingsHa);
print('Área con pérdida de bosque según Hansen (ha):', areaPerdidaBosqueHa);
print('Área de coincidencia entre ambos (ha):', areaCoincidenciaHa);

print('% de la pérdida Hansen capturada por embeddings:',
  ee.Algorithms.If(
    ee.Number(areaPerdidaBosqueHa).gt(0),
    ee.Number(areaCoincidenciaHa).divide(areaPerdidaBosqueHa).multiply(100),
    'sin pérdida de bosque registrada en el AOI'
  ));
print('% de la pérdida de embeddings explicada por pérdida de bosque (Hansen):',
  ee.Algorithms.If(
    ee.Number(areaPerdidaEmbeddingsHa).gt(0),
    ee.Number(areaCoincidenciaHa).divide(areaPerdidaEmbeddingsHa).multiply(100),
    'sin pérdida detectada por embeddings en el AOI'
  ));
```

**Parámetros:**
- **`ee.Image.pixelArea().divide(10000)`**: Genera una imagen con el área real de cada píxel en m², convertida a hectáreas.
- **`geometry: geometry.bounds()`**: Región usada en las cuatro `reduceRegion`: el rectángulo envolvente del AOI original.
- **`areaBosqueYear1Ha`**: Área total (ha) marcada por la máscara de bosque en `year1`. Es el dominio de búsqueda de este análisis: sirve como referencia para poner en contexto qué proporción de ese bosque se perdió, y no solo el área absoluta de pérdida.
- **`areaPerdidaEmbeddingsHa` / `areaPerdidaBosqueHa` / `areaCoincidenciaHa`**: Aplican la máscara de cada capa de resultado sobre la imagen de área por píxel y suman los valores dentro del AOI.
- **`ee.Algorithms.If(condición, valorSiTrue, valorSiFalse)`**: Evita que el script falle por división entre cero si alguna de las áreas de referencia da 0 dentro del AOI.
- **`areaCoincidenciaHa.divide(areaPerdidaBosqueHa).multiply(100)`**: Porcentaje de la pérdida reportada por Hansen que también fue detectada por embeddings; un valor bajo puede indicar que el umbral de similitud es demasiado permisivo.
- **`areaCoincidenciaHa.divide(areaPerdidaEmbeddingsHa).multiply(100)`**: Porcentaje de la pérdida detectada por embeddings que corresponde a tala rasa según Hansen; como los embeddings también pueden capturar degradación gradual dentro del bosque (que Hansen no detecta), se espera que este porcentaje sea menor a 100% incluso con un buen umbral.

## Paso 11: Centrar el mapa

Se centra el visor sobre el AOI original y se cambia la capa base a imágenes satelitales con etiquetas.

```javascript
Map.centerObject(geometry, 9);
Map.setOptions('HYBRID');
```

**Parámetros:**
- **`Map.centerObject(geometry, 9)`**: Centra el visor de mapa sobre el AOI original. El segundo argumento (9) es el nivel de zoom inicial.
- **`Map.setOptions('HYBRID')`**: Cambia la capa base del visor a imagen satelital con nombres de calles y lugares superpuestos.

**Código completo:** [https://code.earthengine.google.com/baf724225e1bc829fe65006222fb5f51](https://code.earthengine.google.com/baf724225e1bc829fe65006222fb5f51)
