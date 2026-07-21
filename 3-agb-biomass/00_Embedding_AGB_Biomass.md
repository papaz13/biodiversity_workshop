---
layout: page
title: 00_Embedding_AGB_Biomass
parent: "Introducción AGB Biomass"
nav_order: 6
---

## 01_AGB_Biomasa_Embedding

# Objetivos

Estimar la densidad de Biomasa Aérea (AGB, en Mg/ha) para una zona de manglar (Bahía Málaga) mediante un modelo de regresión de Random Forest, usando como predictores las 64 bandas del dataset "Satellite Embedding" de Google y como variable de entrenamiento los datos LiDAR de biomasa del sensor GEDI (misión L4A). El script cubre todo el flujo: desde la definición del área y el período de estudio, pasando por el filtrado de calidad de GEDI, el entrenamiento del modelo, hasta la validación (RMSE), la generación del mapa de predicción y el cálculo de la biomasa total en las coberturas de vegetación relevantes.

**Nota importante de terminología:** el resultado de este script es *densidad de biomasa* (Mg/ha), no *carbono*. Para convertir a carbono habría que aplicar un factor adicional (~0.47–0.5), como se hace en el script de Stock de Carbono.

# Datos

- **`GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`** — Embeddings satelitales anuales de Google. Colección de imágenes con 64 bandas (A00–A63) que resumen información espectral, temporal y de contexto de Sentinel-1/2 y otras fuentes, para cada píxel y cada año. Se usa como conjunto de variables predictoras (features) del modelo.<br>
Collection: `ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL')`
- **`LARSE/GEDI/GEDI04_A_002_MONTHLY`** — Datos LiDAR de biomasa GEDI L4A (NASA/UMD). Colección mensual con la banda `agbd` (densidad de biomasa aérea estimada, Mg/ha) y sus bandas de calidad asociadas (`l4_quality_flag`, `degrade_flag`, `agbd_se`). Se usa como variable respuesta (lo que el modelo aprende a predecir).<br>
Collection: `ee.ImageCollection('LARSE/GEDI/GEDI04_A_002_MONTHLY')`
- **`COPERNICUS/DEM/GLO30`** — Modelo digital de elevación global (30 m). Se usa únicamente para calcular la pendiente del terreno y descartar mediciones GEDI poco confiables en zonas de pendiente pronunciada.<br>
Collection: `ee.ImageCollection('COPERNICUS/DEM/GLO30')`
- **`ESA/WorldCover/v200`** — Mapa global de cobertura de la tierra (10 m, año de referencia único). Se usa al final del flujo para enmascarar la predicción y quedarse solo con coberturas de vegetación relevantes (bosques, arbustos, pastizales, cultivos y manglares).<br>
Collection: `ee.ImageCollection('ESA/WorldCover/v200')`

# Métodos

1. Preparación de predictores (Satellite Embedding) y variable respuesta (GEDI L4A)
3. Enmascaramiento de calidad de GEDI (calidad de pulso, error relativo, pendiente)
4. Remuestreo y alineación espacial de ambas capas a una grilla común
5. Muestreo estratificado de datos de entrenamiento
6. Entrenamiento de un modelo de regresión (Random Forest)
7. Validación del modelo (RMSE, gráfico observado vs. predicho)
8. Generación de la imagen de predicción y exportación
9. Enmascaramiento por cobertura de la tierra y cálculo de biomasa total


## Paso a paso

## Paso 1: Definir el área de estudio y el período de tiempo

Se define el polígono de la zona de manglar (Bahía Málaga) y la ventana temporal de un año que se usará para filtrar ambos datasets.

```javascript
var geometry = ee.Geometry.Polygon([
  [
    [-77.45, 4.15],
    [-77.30, 4.15],
    [-77.30, 3.90],
    [-77.45, 3.90],
    [-77.45, 4.15]
  ]
]);

Map.centerObject(geometry, 11);

var startDate = ee.Date.fromYMD(2022, 1, 1);
var endDate = startDate.advance(1, 'year');
```

**Parámetros:**
- **`ee.Geometry.Polygon([[...]])`**: Define el AOI como un polígono manual (lista de coordenadas [lon, lat]). Puede reemplazarse por un polígono dibujado a mano en el editor de GEE.
- **`Map.centerObject(geometry, 11)`**: Centra el visor sobre el AOI; el segundo argumento (11) es el nivel de zoom inicial, apropiado para una bahía.
- **`ee.Date.fromYMD(2022, 1, 1)`**: Fecha de inicio del período de análisis (1 de enero de 2022).
- **`startDate.advance(1, 'year')`**: Calcula la fecha de fin sumando un año a la fecha de inicio, definiendo así una ventana de exactamente un año calendario.

## Paso 2: Cargar y preparar el dataset de predictores (Satellite Embedding)

Se filtran los embeddings por fecha y ubicación, y se genera un mosaico único con la proyección nativa del dataset.

```javascript
var embeddings = ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL');

var embeddingsFiltered = embeddings
  .filter(ee.Filter.date(startDate, endDate))
  .filter(ee.Filter.bounds(geometry));

var embeddingsProjection = ee.Image(embeddingsFiltered.first()).select(0).projection();

var embeddingsImage = embeddingsFiltered.mosaic()
  .setDefaultProjection(embeddingsProjection);
```

**Parámetros:**
- **`.filter(ee.Filter.date(startDate, endDate))`**: Conserva solo la(s) imagen(es) anual(es) que caen dentro de la ventana de tiempo definida en el Paso 1.
- **`.filter(ee.Filter.bounds(geometry))`**: Conserva solo las imágenes que intersectan el AOI, evitando cargar teselas innecesarias.
- **`ee.Image(embeddingsFiltered.first()).select(0).projection()`**: Extrae la proyección nativa de la primera banda de la primera imagen filtrada. Es necesario capturarla explícitamente porque `.mosaic()` no preserva la proyección original por defecto.
- **`.mosaic()`**: Combina todas las imágenes filtradas en una sola, tomando el primer valor no enmascarado disponible por píxel (relevante si el AOI cae en el borde de dos teselas).
- **`.setDefaultProjection(embeddingsProjection)`**: Reasigna al mosaico la proyección nativa capturada antes, necesaria para que los pasos posteriores de remuestreo (`reduceResolution`) funcionen correctamente.

## Paso 3: Cargar y filtrar por calidad el dataset de respuesta (GEDI L4A)

Se filtran las mediciones GEDI por fecha y ubicación, y se aplican tres máscaras de calidad sucesivas para descartar mediciones poco confiables.

```javascript
var qualityMask = function(image) {
  return image.updateMask(image.select('l4_quality_flag').eq(1))
      .updateMask(image.select('degrade_flag').eq(0));
};

var errorMask = function(image) {
  var relative_se = image.select('agbd_se')
    .divide(image.select('agbd'));
  return image.updateMask(relative_se.lte(0.5));
};

var slopeMask = function(image) {
  var glo30 = ee.ImageCollection('COPERNICUS/DEM/GLO30');
  var glo30Filtered = glo30
    .filter(ee.Filter.bounds(geometry))
    .select('DEM');
  var demProj = glo30Filtered.first().select(0).projection();
  var elevation = glo30Filtered.mosaic().rename('dem')
    .setDefaultProjection(demProj);
  var slope = ee.Terrain.slope(elevation);
  return image.updateMask(slope.lt(30));
};

var gediFiltered = gedi
  .filter(ee.Filter.date(startDate, endDate))
  .filter(ee.Filter.bounds(geometry));

var gediProcessed = gediFiltered
  .map(qualityMask)
  .map(errorMask)
  .map(slopeMask);

var gediMosaic = gediProcessed.mosaic()
  .select('agbd').setDefaultProjection(gediProjection);
```

**Parámetros:**
- **`qualityMask`**: Descarta píxeles donde `l4_quality_flag` no es 1 (pulso láser de baja calidad) o donde `degrade_flag` no es 0 (geometría de disparo degradada, por ejemplo por movimiento de la nave).
- **`errorMask`**: Calcula el error estándar relativo (`agbd_se / agbd`) y descarta mediciones donde ese error supera el 50%, es decir, estimaciones estadísticamente poco confiables.
- **`slopeMask`**: Calcula la pendiente del terreno a partir del DEM Copernicus GLO-30 (`ee.Terrain.slope`) y descarta mediciones GEDI sobre pendientes ≥ 30%, donde la geolocalización del pulso láser es menos precisa.
- **`.map(qualityMask).map(errorMask).map(slopeMask)`**: Aplica las tres máscaras en cadena a cada imagen mensual de la colección filtrada.
- **`gediProcessed.mosaic().select('agbd')`**: Combina las imágenes mensuales ya filtradas en un solo mosaico y se queda únicamente con la banda `agbd` (la variable respuesta).

## Paso 4: Remuestrear y alinear ambas capas en una grilla común de 100 m

Se combinan predictores y respuesta en una sola imagen y se remuestrean juntos a una grilla de menor resolución, para evitar desalineaciones espaciales.

```javascript
var gridScale = 100;
var gridProjection = ee.Projection('EPSG:3857').atScale(gridScale);

var stacked = embeddingsImage.addBands(gediMosaic);
var stacked = stacked.resample('bilinear');

var stackedResampled = stacked
  .reduceResolution({
    reducer: ee.Reducer.mean(),
    maxPixels: 1024
  })
  .reproject({
    crs: gridProjection
  });

var stackedResampled = stackedResampled
  .updateMask(stackedResampled.mask().gt(0));
```

**Parámetros:**
- **`gridScale = 100`**: Resolución objetivo en metros de la grilla final de trabajo, más gruesa que la resolución nativa de ambos datasets.
- **`ee.Projection('EPSG:3857').atScale(gridScale)`**: Define la proyección y escala de destino (Web Mercator, píxeles de 100 m) a la que se reproyectarán ambas capas.
- **`embeddingsImage.addBands(gediMosaic)`**: Apila las 64 bandas del embedding junto con la banda `agbd` de GEDI en una sola imagen, para que el remuestreo posterior las procese de forma conjunta y perfectamente alineada.
- **`.resample('bilinear')`**: Cambia el método de remuestreo por defecto (vecino más cercano) a interpolación bilineal, más suave para variables continuas.
- **`.reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 1024 })`**: Agrega los píxeles nativos (más finos) en píxeles de 100 m usando el promedio; `maxPixels: 1024` es el límite de píxeles nativos que puede promediar por cada píxel de salida (con margen amplio, ya que 100 m ÷ 10 m = 10×10 = 100 píxeles).
- **`.reproject({ crs: gridProjection })`**: Aplica la reproyección final a la grilla común definida.
- **`.updateMask(stackedResampled.mask().gt(0))`**: Conserva solo los píxeles donde al menos una banda tiene datos válidos tras el remuestreo, descartando artefactos sin información.

## Paso 5: Exportar el mosaico combinado y reanudar desde el asset

Se exporta la imagen combinada (predictores + respuesta) como asset, para desacoplar el resto del flujo de la disponibilidad "en vivo" de las colecciones filtradas.

```javascript
var exportFolder = 'projects/ee-paulapaz1101/assets/biodiversity_workshop/GEODATA/satellite_embedding/';
var mosaicExportImage = 'gedi_mosaic_bahia_malaga';
var mosaicExportImagePath = exportFolder + mosaicExportImage;

Export.image.toAsset({
  image: stackedResampled.clip(geometry),
  description: 'GEDI_Mosaic_Bahia_Malaga_Export',
  assetId: mosaicExportImagePath,
  region: geometry,
  scale: gridScale,
  maxPixels: 1e10
});

var stackedResampled = ee.Image(mosaicExportImagePath);
```

**Parámetros:**
- **`exportFolder`**: Ruta del asset de destino dentro del proyecto de GEE del usuario; la carpeta debe existir previamente.
- **`Export.image.toAsset({...})`**: Genera una tarea de exportación (pestaña "Tasks") que debe iniciarse manualmente antes de continuar con el resto del script.
- **`stackedResampled.clip(geometry)`**: Recorta la imagen combinada a la forma exacta del AOI antes de exportar.
- **`var stackedResampled = ee.Image(mosaicExportImagePath)`**: Una vez completada la exportación, esta línea vuelve a cargar la imagen ya exportada desde el asset, para que los pasos siguientes trabajen sobre una versión estable y persistente en vez de recalcular todo el flujo anterior cada vez.

## Paso 6: Extraer las muestras de entrenamiento

Se identifican los predictores y la variable respuesta, y se extraen muestras estratificadas solo en los píxeles donde existe dato real de GEDI.

```javascript
var predictors = embeddingsImage.bandNames();
var predicted = gediMosaic.bandNames().get(0);

var predictorImage = stackedResampled.select(predictors);
var predictedImage = stackedResampled.select([predicted]);

var classMask = predictedImage.mask().toInt().rename('class');

var numSamples = 1000;

var training = stackedResampled.addBands(classMask)
  .stratifiedSample({
    numPoints: numSamples,
    classBand: 'class',
    region: geometry,
    scale: gridScale,
    classValues: [0, 1],
    classPoints: [0, numSamples],
    dropNulls: true,
    tileScale: 16,
  });
```

**Parámetros:**
- **`embeddingsImage.bandNames()`**: Obtiene la lista de nombres de las 64 bandas del embedding, que se usarán como variables predictoras del modelo.
- **`gediMosaic.bandNames().get(0)`**: Obtiene el nombre de la única banda de GEDI (`'agbd'`), la variable a predecir.
- **`classMask`**: Imagen binaria (0/1) que marca con 1 los píxeles donde `agbd` tiene un valor válido (no enmascarado), y con 0 el resto.
- **`stratifiedSample({...})`**: Extrae puntos de muestreo estratificados según la banda `class`.
- **`classValues: [0, 1], classPoints: [0, numSamples]`**: Indica tomar 0 muestras de la clase 0 (píxeles sin dato GEDI) y 1000 de la clase 1 (píxeles con dato real), asegurando que todas las muestras caigan donde hay información de entrenamiento útil.
- **`dropNulls: true`**: Descarta cualquier muestra que, pese al filtro anterior, tenga un valor nulo en alguna banda (por ejemplo, en algún predictor).
- **`tileScale: 16`**: Reparte el cálculo en teselas más pequeñas para evitar errores de memoria en el servidor de GEE.

## Paso 7: Entrenar el modelo de regresión

Se entrena un modelo de Random Forest en modo regresión, usando las bandas del embedding como predictores y `agbd` como variable objetivo.

```javascript
var model = ee.Classifier.smileRandomForest(50)
  .setOutputMode('REGRESSION')
  .train({
    features: training,
    classProperty: predicted,
    inputProperties: predictors
  });

var predicted = training.classify({
  classifier: model,
  outputName: 'agbd_predicted'
});
```

**Parámetros:**
- **`ee.Classifier.smileRandomForest(50)`**: Define un modelo de Random Forest con 50 árboles de decisión.
- **`.setOutputMode('REGRESSION')`**: Configura el clasificador para que devuelva un valor numérico continuo (regresión) en vez de una clase categórica.
- **`.train({ features: training, classProperty: predicted, inputProperties: predictors })`**: Entrena el modelo con las muestras extraídas (`training`), usando `agbd` (`predicted`) como variable a predecir y las 64 bandas del embedding (`predictors`) como variables de entrada.
- **`training.classify({ classifier: model, outputName: 'agbd_predicted' })`**: Aplica el modelo ya entrenado sobre las mismas muestras de entrenamiento, generando una nueva propiedad `agbd_predicted` para cada punto — necesaria para evaluar el ajuste del modelo en el paso siguiente.

## Paso 8: Validar el modelo (RMSE y gráfico observado vs. predicho)

Se calcula el error cuadrático medio (RMSE) y se genera un gráfico de dispersión para evaluar visualmente el ajuste del modelo.

```javascript
var calculateRmse = function(input) {
  var observed = ee.Array(input.aggregate_array('agbd'));
  var predicted = ee.Array(input.aggregate_array('agbd_predicted'));
  var rmse = observed.subtract(predicted).pow(2)
    .reduce('mean', [0]).sqrt().get([0]);
  return rmse;
};
var rmse = calculateRmse(predicted);
print('RMSE', rmse);

var chart = ui.Chart.feature.byFeature({
  features: predicted.select(['agbd', 'agbd_predicted']),
  xProperty: 'agbd',
  yProperties: ['agbd_predicted'],
}).setChartType('ScatterChart')
  .setOptions({
    title: 'Densidad de Biomasa Aérea - Bahía Málaga (Mg/Ha)',
    trendlines: { 0: { type: 'linear', showR2: true } }
  });
print(chart);
```

**Parámetros:**
- **`calculateRmse(input)`**: Función que compara, punto por punto, el valor observado (`agbd`) contra el predicho (`agbd_predicted`): resta ambos arreglos, eleva la diferencia al cuadrado, calcula la media y extrae la raíz cuadrada — la fórmula estándar del RMSE.
- **`ee.Array(...aggregate_array(...))`**: Convierte la columna de una `FeatureCollection` en un arreglo del lado del servidor, necesario para operaciones matriciales vectorizadas.
- **`ui.Chart.feature.byFeature({...}).setChartType('ScatterChart')`**: Genera un gráfico de dispersión con `agbd` (observado) en el eje X y `agbd_predicted` en el eje Y.
- **`trendlines: { 0: { type: 'linear', showR2: true } }`**: Agrega una línea de tendencia lineal al gráfico y muestra el coeficiente de determinación (R²), indicador adicional de qué tan bien el modelo explica la variabilidad observada.

## Paso 9: Generar la imagen de predicción y exportarla

Se aplica el modelo entrenado sobre toda la imagen combinada (no solo las muestras) para generar un mapa continuo de AGB predicho, y se exporta como asset.

```javascript
var predictedImage = stackedResampled.classify({
  classifier: model,
  outputName: 'agbd'
});

var predictedExportImage = 'predicted_agbd_bahia_malaga';
var predictedExportImagePath = exportFolder + predictedExportImage;

Export.image.toAsset({
  image: predictedImage.clip(geometry),
  description: 'Predicted_AGBD_Bahia_Malaga_Export',
  assetId: predictedExportImagePath,
  region: geometry,
  scale: gridScale,
  maxPixels: 1e10
});

var predictedImage = ee.Image(predictedExportImagePath);
```

**Parámetros:**
- **`stackedResampled.classify({ classifier: model, outputName: 'agbd' })`**: Aplica el modelo de Random Forest píxel por píxel sobre toda la imagen (no solo los puntos de muestra), generando una banda `agbd` con el valor de biomasa predicho en cada píxel de la grilla.
- **`Export.image.toAsset({...})`**: Igual que en el Paso 5, exporta el mapa de predicción como asset persistente antes de continuar, para desacoplar el resto del flujo del reentrenamiento del modelo.
- **`var predictedImage = ee.Image(predictedExportImagePath)`**: Recarga la imagen ya exportada, sobre la cual se trabajará en los pasos de visualización y cálculo de biomasa total.

## Paso 10: Visualizar la predicción

```javascript
var gediVis = {
  min: 0,
  max: 200,
  palette: ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'],
  bands: ['agbd']
};

Map.addLayer(predictedImage, gediVis, 'AGBD Predicho - Bahía Málaga');
```

**Parámetros:**
- **`min: 0, max: 200`**: Rango de valores de AGB (Mg/ha) que se mapea a la paleta de colores.
- **`palette: [...]`**: Rampa de color de menor a mayor densidad de biomasa, de un verde muy pálido a un verde oscuro intenso.

## Paso 11: Enmascarar por cobertura de la tierra (incluye manglares)

Se restringe el mapa de predicción únicamente a las coberturas de vegetación de interés, usando ESA WorldCover.

```javascript
var worldcover = ee.ImageCollection('ESA/WorldCover/v200').first();

var worldcoverResampled = worldcover
  .reduceResolution({ reducer: ee.Reducer.mode(), maxPixels: 1024 })
  .reproject({ crs: gridProjection });

var landCoverMask = worldcoverResampled.eq(10)
  .or(worldcoverResampled.eq(20))
  .or(worldcoverResampled.eq(30))
  .or(worldcoverResampled.eq(40))
  .or(worldcoverResampled.eq(95));

var predictedImageMasked = predictedImage.updateMask(landCoverMask);
```

**Parámetros:**
- **`ee.ImageCollection('ESA/WorldCover/v200').first()`**: Extrae la única imagen global de cobertura de la tierra disponible en esta colección.
- **`reduceResolution({ reducer: ee.Reducer.mode(), maxPixels: 1024 })`**: Remuestrea la cobertura (originalmente a 10 m) a la grilla de 100 m usando la **moda** (clase más frecuente), apropiado para variables categóricas (a diferencia del promedio usado para variables continuas en el Paso 4).
- **`worldcoverResampled.eq(10).or(...eq(20))...`**: Construye una máscara booleana que es 1 donde la cobertura corresponde a: 10 = bosques, 20 = arbustos, 30 = pastizales, 40 = cultivos, o 95 = manglares.
- **`predictedImage.updateMask(landCoverMask)`**: Aplica esa máscara al mapa de predicción, descartando estimaciones de biomasa sobre coberturas no vegetadas (agua, urbano, suelo desnudo, etc.).

## Paso 12: Calcular la biomasa total

Se convierte la densidad de biomasa (Mg/ha) en biomasa absoluta por píxel y se suma sobre todo el AOI.

```javascript
var pixelAreaHa = ee.Image.pixelArea().divide(10000);
var predictedAgb = predictedImageMasked.multiply(pixelAreaHa);

var stats = predictedAgb.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: geometry,
  scale: gridScale,
  maxPixels: 1e10,
  tileScale: 16
});

var totalAgb = stats.getNumber('agbd');
print('Biomasa Total (Mg) - Bahía Málaga', totalAgb);
```

**Parámetros:**
- **`ee.Image.pixelArea().divide(10000)`**: Genera el área real de cada píxel en hectáreas (m² ÷ 10 000), igual que en el script de Stock de Carbono.
- **`predictedImageMasked.multiply(pixelAreaHa)`**: Convierte la densidad (Mg/ha) en biomasa absoluta por píxel (Mg), multiplicando por el área real de cada píxel.
- **`reduceRegion({ reducer: ee.Reducer.sum(), ... })`**: Suma la biomasa absoluta de todos los píxeles válidos (ya enmascarados por cobertura) dentro del AOI.
- **`stats.getNumber('agbd')`**: Extrae el valor numérico del diccionario resultante, usando el nombre de banda `'agbd'` como clave.
- **`print('Biomasa Total (Mg) - Bahía Málaga', totalAgb)`**: Reporta el resultado final: la biomasa aérea total estimada, en toneladas, para las coberturas de vegetación relevantes dentro del AOI.








# Objetivos
Calcular dos indicadores de conservación dentro de un área de interés (AOI):

1. El porcentaje del territorio bajo alguna figura de protección (indicador vinculado a la Meta 3 — "30x30" — del Marco Mundial de Biodiversidad Kunming-Montreal).
2. La representatividad ecológica por ecorregión, para identificar vacíos de conservación.

## Datos

- **`WCMC/WDPA/current/polygons`** — Base de Datos Mundial de Áreas Protegidas (WDPA). <br>
Collection: `ee.FeatureCollection("WCMC/WDPA/current/polygons")`
- **`RESOLVE/ECOREGIONS/2017`** — Ecorregiones terrestres del mundo (Dinerstein et al., 2017).<br>
 Collection: `ee.FeatureCollection("RESOLVE/ECOREGIONS/2017")`
- **`FAO/GAUL_SIMPLIFIED_500m/2015/level0`** — Límites administrativos nacionales, pre-simplificados.<br>
 Collection: `ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level0")`

## Métodos

1. Rasterización de vectores
2. Cálculo del área de la geometría
3. Filtrado de datos

## Paso a paso
## Paso 1: Definir el área de interés (AOI) y parámetros generales

Se define el AOI —en este caso, un país (Colombia) tomado del dataset de límites administrativos— y los parámetros que controlan precisión y rendimiento del resto del script.

```javascript
var area = GAUL0.filter(
	ee.Filter.eq('ADM0_NAME', 'Colombia')
);

var geom = area.geometry();
var geomBounds = geom.bounds(1000);

Map.centerObject(area, 6);

var ESCALA = 300;
var MAXPIX = 1e13;
var TILESCALE = 16;
```

**Parámetros:**
- **`GAUL0.filter(ee.Filter.eq('ADM0_NAME', 'Colombia'))`**: Selecciona, dentro de la colección de países, el feature (o features) cuyo atributo `ADM0_NAME` sea exactamente `'Colombia'`. `ee.Filter.eq()` es un filtro de igualdad exacta: el texto debe coincidir letra por letra.
- **`area.geometry()`**: Extrae la geometría del país seleccionado. Si el filtro devolviera más de un feature, esta geometría sería la unión de todos ellos.
- **`geom.bounds(1000)`**: Calcula el rectángulo envolvente (bounding box) de la geometría. El argumento (`1000`) es el `maxError` en metros: la tolerancia permitida en el cálculo, que acelera la operación sin afectar el resultado (un rectángulo no tiene curvas que simplificar).
- **`Map.centerObject(area, 6)`**: Centra el mapa sobre el AOI. El segundo argumento (`6`) es el nivel de zoom inicial del visor (escala logarítmica de Google Maps: valores más altos acercan la vista).
- **`ESCALA`**: Resolución en metros usada por todas las `reduceRegion` del script (ver Sección 3). 300 m es apropiado para un análisis a nivel país; para un AOI más chico (un parque, un municipio) se puede bajar a 30–100 m sin afectar el rendimiento.
- **`MAXPIX` y `TILESCALE`**: Ver Sección 3. Se definen acá como variables porque se reutilizan en los Pasos 6 y 8.

## Paso 2: Construir una máscara ráster del AOI

Se convierte el contorno del país en una máscara binaria (imagen), que se usará más adelante para recortar otras imágenes por álgebra de bandas en vez de por geometría vectorial.

```javascript
var maskPais = ee.Image.constant(1).clip(geom).mask().rename('pais');
```

**Parámetros:**
- **`ee.Image.constant(1)`**: Crea una imagen con valor 1 en absolutamente todos los píxeles del planeta (una banda constante).
- **`.clip(geom)`**: Recorta esa imagen a la forma exacta del AOI: fuera del polígono, los píxeles quedan sin dato (masked).
- **`.mask()`**: Extrae únicamente la máscara resultante (1 = dentro del AOI, 0/sin dato = fuera), separada de los valores de la imagen. Esta máscara se puede aplicar luego a cualquier otra imagen con `updateMask()`.
- **`.rename('pais')`**: Asigna un nombre a la banda, útil para identificarla si se combina con otras bandas más adelante.

## Paso 3: Calcular el área total del AOI

El área administrativa del país se obtiene directamente de su geometría, sin necesidad de procesar ninguna imagen.

```javascript
var haTotal = ee.Number(geom.area({maxError: 1000})).divide(10000);
```

**Parámetros:**
- **`geom.area({maxError: 1000})`**: Calcula el área de la geometría en metros cuadrados. `maxError` (en metros) es la tolerancia de simplificación permitida durante el cálculo: cuanto mayor, más rápido el cómputo, a costa de una precisión ligeramente menor en geometrías con muchos vértices.
- **`ee.Number(...)`**: Convierte el resultado (que GEE entrega como un objeto genérico del lado del servidor) a un tipo `Number` explícito, necesario para poder operar con `.divide()` a continuación.
- **`.divide(10000)`**: Convierte de metros cuadrados a hectáreas (1 ha = 10 000 m²).

## Paso 4: Identificar las áreas protegidas que intersectan el AOI

Se seleccionan, de toda la WDPA mundial, los polígonos de áreas protegidas que tocan el territorio del AOI y que tienen un estatus legal vigente.

```javascript
var wdpa = WDPA
	.filterBounds(geom)
    .filter(ee.Filter.neq('STATUS', 'Proposed'));

print('Áreas protegidas encontradas:', wdpa.size());
```

**Parámetros:**
- **`WDPA.filterBounds(geom)`**: Conserva únicamente los polígonos de la WDPA cuya geometría intersecta (toca, total o parcialmente) el AOI. Es una prueba geométrica real, no una comparación de rectángulos envolventes.
- **`ee.Filter.neq('STATUS', 'Proposed')`**: Excluye los registros cuyo campo `STATUS` sea `'Proposed'` (propuestas de protección aún no formalizadas), para que el indicador refleje solo protección legalmente vigente.
- **`wdpa.size()`**: Cuenta cuántos polígonos cumplen ambos filtros. Este número incluye TODA la cobertura de protección relevante para el AOI (áreas grandes, reservas vecinas, zonas superpuestas), porque eso es exactamente lo que se necesita para construir el raster del Paso 5: cuánta superficie protegida hay dentro del territorio, sin importar cuántos polígonos individuales la componen.

## Paso 5: Rasterizar las áreas protegidas (vector → raster)

Se convierte la colección de polígonos protegidos en una imagen binaria (0/1) recortada al AOI, que es la que se usa en el resto del script para calcular áreas.

```javascript
var apImg = wdpa
	.map(function (f) {
    	return f.set('valor', 1);
	})
	.reduceToImage({
    	properties: ['valor'],
    	reducer: ee.Reducer.first()
	})
	.gt(0)
	.unmask(0)
	.updateMask(maskPais)
	.rename('ap');
```

**Parámetros:**
- **`.map(function(f){ return f.set('valor', 1); })`**: Recorre cada polígono de `wdpa` y le asigna la propiedad numérica `'valor'` = 1. Esta propiedad es la que se va a "pintar" en cada píxel al rasterizar.
- **`.reduceToImage({ properties: ['valor'], reducer: ee.Reducer.first() })`**: Convierte la colección de polígonos en una imagen: para cada píxel, toma el valor de la propiedad `'valor'` del primer polígono que lo cubre (`ee.Reducer.first()` define ese criterio de desempate cuando hay superposición).
- **`.gt(0)`**: Convierte la imagen a estrictamente binaria: 1 donde había algún polígono, 0/sin dato en el resto.
- **`.unmask(0)`**: Reemplaza los píxeles sin dato (fuera de cualquier polígono protegido) por un 0 explícito. Es necesario para que, más adelante, al sumar bandas (Paso 8), esos píxeles se contabilicen correctamente como "no protegido" en vez de quedar excluidos del cálculo.
- **`.updateMask(maskPais)`**: Aplica la máscara del AOI calculada en el Paso 2: cualquier píxel fuera del país queda sin dato, sin importar si estaba o no protegido.
- **`.rename('ap')`**: Nombra la banda resultante `'ap'`, para poder referenciarla sin ambigüedad al combinarla con otras bandas.

## Paso 6: Calcular el indicador global de protección (Meta 3 — 30x30)

Se suma el área protegida en hectáreas y se calcula el porcentaje del AOI bajo alguna figura de protección.

```javascript
var haAP = ee.Number(
    apImg.multiply(ee.Image.pixelArea())
    	.reduceRegion({
        	reducer: ee.Reducer.sum(),
        	geometry: geomBounds,
        	scale: ESCALA,
        	bestEffort: true,
        	tileScale: TILESCALE,
        	maxPixels: MAXPIX
    	}).values().get(0)
).divide(10000);

print('Área total (ha)', haTotal);
print('Área protegida (ha)', haAP);
print('% protegido', haAP.divide(haTotal).multiply(100));
```

**Parámetros:**
- **`apImg.multiply(ee.Image.pixelArea())`**: `ee.Image.pixelArea()` genera una imagen donde cada píxel contiene su propio área real en m² (varía levemente con la latitud). Al multiplicarla por `apImg` (0/1), el resultado es una imagen donde cada píxel protegido vale su área en m², y cada píxel no protegido vale 0.
- **`geometry: geomBounds`**: Se usa el rectángulo envolvente del AOI (no `geom`) como región del `reduceRegion`. Los parámetros `scale`, `bestEffort`, `tileScale` y `maxPixels` están explicados en la Sección 3.
- **`.values().get(0)`**: `reduceRegion()` devuelve un diccionario con una entrada por banda de la imagen (acá solo hay una). `.values()` extrae los valores del diccionario como una lista, y `.get(0)` toma el primero (y único).
- **`haAP.divide(haTotal).multiply(100)`**: Calcula el porcentaje del AOI que está protegido. Como `haAP` y `haTotal` son `ee.Number`, esta operación ocurre del lado del servidor de GEE, no en el navegador.

## Paso 7: Identificar las ecorregiones del AOI y preparar la banda de agrupación

Se seleccionan las ecorregiones presentes en el AOI y se rasteriza su identificador numérico, insumo necesario para el cálculo agrupado del paso siguiente.

```javascript
var eco = ECOREGIONES.filterBounds(geom);
print('Número de ecorregiones:', eco.size());

var ecoIdImg = eco
    .reduceToImage({
    	properties: ['ECO_ID'],
    	reducer: ee.Reducer.first()
	})
	.toInt()
	.rename('eco_id');
```

**Parámetros:**
- **`ECOREGIONES.filterBounds(geom)`**: Conserva solo las ecorregiones que intersectan el AOI (una ecorregión puede extenderse mucho más allá de un solo país).
- **`reduceToImage({ properties: ['ECO_ID'], ... })`**: Rasteriza el campo `ECO_ID` (numérico) en vez de `ECO_NAME` (texto), porque el reducer agrupado del Paso 8 necesita una banda numérica para poder agrupar valores por ella.
- **`.toInt()`**: Convierte la banda a números enteros, evitando que pequeñas diferencias de punto flotante generen grupos duplicados o inconsistentes en el Paso 8.

## Paso 8: Calcular la representatividad por ecorregión con una reducción agrupada

Se resuelve, en una sola operación sobre todo el AOI, cuánta área total y cuánta área protegida hay dentro de cada ecorregión.

```javascript
var stackImg = ee.Image.pixelArea().rename('total')
    .addBands(apImg.multiply(ee.Image.pixelArea()).rename('protegida'))
    .addBands(ecoIdImg)
	.updateMask(maskPais);

var groupedReducer = ee.Reducer.sum().repeat(2).group({
	groupField: 2,
	groupName: 'eco_id'
});

var statsRaw = stackImg.reduceRegion({
	reducer: groupedReducer,
	geometry: geomBounds,
	scale: ESCALA,
	bestEffort: true,
	tileScale: TILESCALE,
	maxPixels: MAXPIX
});

var grupos = ee.List(statsRaw.get('groups'));

var idToName = ee.Dictionary.fromLists(
    eco.aggregate_array('ECO_ID').map(function (id) {
    	return ee.Number(id).format();
	}),
    eco.aggregate_array('ECO_NAME')
);

var ecoStats = ee.FeatureCollection(grupos.map(function (g) {
	g = ee.Dictionary(g);
	var id = ee.Number(g.get('eco_id'));
	var sums = ee.List(g.get('sum'));
	var total = ee.Number(sums.get(0));
	var protegida = ee.Number(sums.get(1));
    var pct = ee.Algorithms.If(total.gt(0), protegida.divide(total).multiply(100), 0);

	return ee.Feature(null, {
    	eco_id: id,
    	ecorregion: idToName.get(id.format()),
    	ha_total: total.divide(10000),
    	ha_protegida: protegida.divide(10000),
    	pct_protegido: pct
    });
}));
```

**Parámetros:**
- **`stackImg`**: Combina en una sola imagen de 3 bandas todo lo necesario para el cálculo: `'total'` (área de cada píxel), `'protegida'` (área solo donde `apImg`=1) y `'eco_id'` (el identificador de ecorregión). El orden de las bandas importa: el reducer agrupado espera las bandas de datos primero y la banda de agrupación al final.
- **`ee.Reducer.sum().repeat(2)`**: Crea un reducer que suma valores, y `.repeat(2)` indica que debe aplicarse a 2 bandas de entrada en simultáneo (acá, `'total'` y `'protegida'`), devolviendo una suma para cada una.
- **`.group({ groupField: 2, groupName: 'eco_id' })`**: Envuelve el reducer anterior para que, en vez de una sola suma global, calcule una suma por cada valor distinto de la banda indicada en `groupField` (índice 2, correspondiente a `'eco_id'` dentro del stack). `groupName` define el nombre de la clave en el resultado.
- **`statsRaw.get('groups')`**: El resultado de un reducer agrupado es un diccionario con una clave `'groups'`, cuyo valor es una lista de diccionarios: uno por cada grupo encontrado, con la forma `{eco_id: <valor>, sum: [sumaTotal, sumaProtegida]}`.
- **`ee.Dictionary.fromLists(claves, valores)`**: Construye un diccionario del lado del servidor a partir de dos listas paralelas. Acá se usa para mapear cada `ECO_ID` a su `ECO_NAME` correspondiente, sin necesidad de traer datos al cliente antes de tiempo (`getInfo`).
- **`eco.aggregate_array('ECO_ID')`**: Extrae, como una lista, los valores de la propiedad `ECO_ID` de todos los features de `eco`. `.map(...)` los convierte a texto (`id.format()`) porque las claves de un `ee.Dictionary` deben ser strings.
- **`grupos.map(function(g){...})`**: Recorre la lista de grupos y reconstruye, por cada uno, un `ee.Feature` con las columnas finales: `eco_id`, `ecorregion` (nombre), `ha_total`, `ha_protegida` y `pct_protegido`.
- **`ee.Algorithms.If(total.gt(0), ..., 0)`**: Condicional evaluado del lado del servidor (no un `if` de JavaScript): es necesario porque `'total'` es un `ee.Number` cuyo valor real no existe hasta que el servidor lo calcula. Evita una división por cero si alguna ecorregión no tuviera área dentro del AOI.
- **`ee.Feature(null, {...})`**: Crea un registro tabular sin geometría (`null`), solo con las propiedades indicadas. El conjunto de estos features forma la `FeatureCollection` final `ecoStats`.

## Paso 9: Generar el gráfico de representatividad

Se construye un gráfico de barras que muestra, para cada ecorregión, el porcentaje protegido calculado en el paso anterior.

```javascript
var chart = ui.Chart.feature.byFeature(
	ecoStats,
	'ecorregion',
	'pct_protegido'
)
	.setChartType('BarChart')
	.setOptions({
    	title: '% protegido por ecorregión',
    	legend: { position: 'none' },
    	hAxis: { title: 'Ecorregión' },
    	vAxis: { title: '% protegido' }
	});

print(chart);
```

**Parámetros:**
- **`ui.Chart.feature.byFeature(collection, xProperty, yProperty)`**: Construye un gráfico donde cada feature de la colección (`ecoStats`) se convierte en una barra. El primer argumento es la `FeatureCollection` de origen; `xProperty` (`'ecorregion'`) es la propiedad que etiqueta el eje X; `yProperty` (`'pct_protegido'`) es la propiedad que define la altura de cada barra.
- **`.setChartType('BarChart')`**: Define el tipo de gráfico. Otros valores válidos incluyen `'ColumnChart'` (barras verticales agrupadas), `'LineChart'`, `'PieChart'`, `'ScatterChart'`, entre otros de la librería Google Charts sobre la que se apoya `ui.Chart`.
- **`title`**: Texto que aparece como título del gráfico, en la parte superior.
- **`legend: { position: 'none' }`**: Controla la leyenda del gráfico. `'none'` la oculta (apropiado cuando hay una sola serie de datos, como acá); otros valores posibles son `'right'`, `'top'`, `'bottom'`, `'in'`.
- **`hAxis: { title: 'Ecorregión' }`**: Configura el eje horizontal (X); `'title'` es el texto que se muestra como etiqueta de ese eje. Puede combinarse con otras propiedades como `'slantedText: true'` si las etiquetas son largas y se superponen.
- **`vAxis: { title: '% protegido' }`**: Configura el eje vertical (Y) de la misma forma; adicionalmente admite propiedades como `'minValue'` / `'maxValue'` para fijar el rango del eje.
- **`print(chart)`**: Envía el objeto gráfico a la consola del editor de GEE, donde se renderiza como un gráfico interactivo (permite pasar el mouse sobre las barras para ver el valor exacto).

## Paso 10: Visualizar las capas en el mapa

Se agregan tres capas al visor de GEE: las ecorregiones, el raster de áreas protegidas y el contorno del AOI, cada una con su propio estilo y visibilidad inicial.

```javascript
Map.addLayer(eco, { color: 'gray' }, 'Ecorregiones', false);

Map.addLayer(apImg.selfMask(), { palette: ['006400'] }, 'Áreas protegidas');

Map.addLayer(area, { color: 'red' }, 'Área de interés', false);
```

**Parámetros:**
- **`Map.addLayer(eeObject, visParams, name, shown)`**: Firma general de la función: `eeObject` es la capa a mostrar (una imagen o una colección de features); `visParams` define su estilo visual; `name` es el texto que aparece en el panel "Layers" del visor; `shown` (booleano) controla si la capa arranca visible (`true`, valor por defecto) u oculta (`false`).
- **`{ color: 'gray' }` / `{ color: 'red' }`**: Para `FeatureCollection`s, la propiedad `color` del objeto de estilo define el color de los bordes/relleno, usando un nombre de color CSS o un código hexadecimal (por ejemplo, `'FF0000'` equivale a `'red'`).
- **`{ palette: ['006400'] }`**: Para imágenes de una sola banda, `palette` define la rampa de color con la que se pintan los valores, de menor a mayor, como una lista de códigos hexadecimales. Con una imagen binaria (0/1) y un solo color en la paleta, todos los píxeles con valor 1 se pintan de ese color.
- **`apImg.selfMask()`**: Antes de visualizar, se enmascaran los píxeles con valor 0, para que en el mapa solo se dibujen (y por tanto solo ocupen memoria de renderizado) los píxeles efectivamente protegidos.
- **`false` (último argumento)**: En las capas "Ecorregiones" y "Área de interés", hace que esas capas se agreguen al mapa pero permanezcan ocultas hasta que el usuario las active manualmente desde el panel Layers — útil para no saturar la vista inicial con capas de referencia.

## Paso 11: Exportar los resultados

Los resultados finales se envían como una tarea de exportación a Google Drive, en vez de depender únicamente de los `print()` interactivos.

```javascript
Export.table.toDrive({
	collection: ecoStats,
	description: 'representatividad_ecorregion_colombia',
    fileFormat: 'CSV'
});

/*
Export.image.toDrive({
	image: apImg,
	description: 'areas_protegidas_colombia',
    region: geomBounds,
    scale: ESCALA,
    maxPixels: MAXPIX
});
*/
```

**Parámetros:**
- **`Export.table.toDrive({...})`**: Genera una tarea de exportación de una tabla (`FeatureCollection`) a Google Drive. La tarea queda pendiente en la pestaña "Tasks" del editor y debe iniciarse manualmente (botón "Run").
- **`collection`**: La `FeatureCollection` a exportar; acá, la tabla de representatividad por ecorregión.
- **`description`**: Nombre de la tarea (visible en la pestaña Tasks) y, por defecto, también el nombre del archivo de salida.
- **`fileFormat: 'CSV'`**: Formato del archivo tabular exportado. Otros valores válidos para tablas son `'SHP'` (Shapefile), `'GeoJSON'` y `'KML'` — estos dos últimos requieren que los features tengan geometría, lo cual no es el caso de `ecoStats` (son features con `geometry: null`).
- **`Export.image.toDrive({...})` (bloque comentado)**: Exporta una imagen (acá, el raster binario `apImg`) en vez de una tabla. `image` es la imagen a exportar; `region` define el área geográfica a exportar (se usa el rectángulo envolvente por la misma razón de rendimiento explicada en el Paso 1); `scale` y `maxPixels` cumplen el mismo rol que en `reduceRegion` (Sección 3).

**Código completo:** [https://code.earthengine.google.com/ede3f4c12ec8512f68d73d23d5735d82?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop](https://code.earthengine.google.com/ede3f4c12ec8512f68d73d23d5735d82?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop)







