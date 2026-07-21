// Tutorial: Regression with Satellite Embedding
// Objetivo: Estimación de Biomasa Aérea (AGB) - Manglares
// ****************************************************
// Use the satellite basemap
Map.setOptions('SATELLITE');

// =========================================================================
// 1. DEFINIR ZONA DE ESTUDIO (ROI) - Bahía Málaga
// =========================================================================
// Polígono aproximado cubriendo la bahía y sus zonas de manglar.
// Ajustar estas coordenadas si quieres otra zona de interés:
// puedes dibujar tu propio polígono en el editor de GEE
// (icono de polígono en el mapa) y reemplazar 'geometry' por esa variable.

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

// =========================================================================
// 2. DEFINIR PERIODO DE TIEMPO
// =========================================================================

var startDate = ee.Date.fromYMD(2022, 1, 1);
var endDate = startDate.advance(1, 'year');

// =========================================================================
// 3. Importar dataset de Satellite Embedding
// =========================================================================
var embeddings = ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL');

var embeddingsFiltered = embeddings
  .filter(ee.Filter.date(startDate, endDate))
  .filter(ee.Filter.bounds(geometry));

// Extraer la proyección de la primera banda de la primera imagen
var embeddingsProjection = ee.Image(embeddingsFiltered.first()).select(0).projection();

// Establecer la proyección del mosaico
var embeddingsImage = embeddingsFiltered.mosaic()
  .setDefaultProjection(embeddingsProjection);

Map.addLayer(embeddingsImage, '', 'embeddingsImage', false);

// =========================================================================
// 4. Importar dataset de mosaico GEDI L4A
// =========================================================================
var gedi = ee.ImageCollection('LARSE/GEDI/GEDI04_A_002_MONTHLY');

// Función para seleccionar datos GEDI de alta calidad
//con el fin de descartar datos de baja calidad 
//(nubes, pendientes pronunciadas, alto error relativo)
//donde: l4_quality_flag y degrade_flag: indicadores de calidad del pulso láser.
var qualityMask = function(image) {
  return image.updateMask(image.select('l4_quality_flag').eq(1))
      .updateMask(image.select('degrade_flag').eq(0));
};

// Función para enmascarar mediciones GEDI poco confiables
// error estándar relativo > 50% => agbd_se / agbd > 0.5
// agbd: biomasa aérea estimada (Mg/ha)-> el valor que vamos a predecir
//donde agbd_se: error estándar de esa estimación.
var errorMask = function(image) {
  var relative_se = image.select('agbd_se')
    .divide(image.select('agbd'));
  return image.updateMask(relative_se.lte(0.5));
};

// Función para enmascarar mediciones GEDI en pendientes > 30%
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

var gediProjection = ee.Image(gediFiltered.first())
  .select('agbd').projection();

var gediProcessed = gediFiltered
  .map(qualityMask)
  .map(errorMask)
  .map(slopeMask);

var gediMosaic = gediProcessed.mosaic()
  .select('agbd').setDefaultProjection(gediProjection);

// Visualizar el mosaico GEDI
var gediVis = {
  min: 0,
  max: 200,
  palette: ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'],
  bands: ['agbd']
};

// Verifica en el mapa la disponibilidad de datos GEDI para el AOI
Map.addLayer(gediMosaic, gediVis, 'GEDI L4A (Filtrado)', true);

// =========================================================================
// 5. Remuestrear imágen embedding y GEDI  y poner en grilla de 100m
// =========================================================================

//Definir la grilla de destino: proyección EPSG:385 con píxeles de 100 metros
var gridScale = 100;
var gridProjection = ee.Projection('EPSG:3857')
  .atScale(gridScale);

//Juntar las dos imágenes en una sola: las 64 bandas del embedding + la banda agbd de GEDI, todo en el mismo objeto. 
//Así se remuestrean juntas y quedan perfectamente alineadas.
//Usar el método de remuestreo 'bilinear'
var stacked = embeddingsImage.addBands(gediMosaic);

var stacked = stacked.resample('bilinear');

var stackedResampled = stacked
  .reduceResolution({
    reducer: ee.Reducer.mean(),
    maxPixels: 1024 //límite de cuántos píxeles puede promediar por cada píxel grande (100 m ÷ 10 m = 10×10 = 100 píxeles, así que 1024 da margen de sobra).
  })
  .reproject({
    crs: gridProjection
  });

var stackedResampled = stackedResampled
  .updateMask(stackedResampled.mask().gt(0));

// IMPORTANTE: Reemplaza esto con tu propia carpeta de assets de GEE.
// La carpeta debe existir antes de exportar.
// Ejemplo: 'projects/tu-proyecto-gee/assets/manglares_bahia_malaga/'
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

// Espera a que la exportación termine, y continúa
// con el mosaico exportado desde aquí en adelante.
var stackedResampled = ee.Image(mosaicExportImagePath);

// =========================================================================
// 6. Extraer características de entrenamiento
// =========================================================================

//Define cuáles son las variables de entrada (predictors — las 64 bandas del Satellite Embedding)
//y la variable a predecir (predicted — el nombre de la única banda de GEDI, que es 'agbd')
var predictors = embeddingsImage.bandNames();
var predicted = gediMosaic.bandNames().get(0);
print('predictors', predictors);
print('predicted', predicted);

var predictorImage = stackedResampled.select(predictors);
var predictedImage = stackedResampled.select([predicted]);

var classMask = predictedImage.mask().toInt().rename('class');

var numSamples = 1000;

//Agrega la banda class a la imagen completa.
//Parámetros:
//stratifiedSample es una función que toma muestras por clase, no al azar en toda la imagen.
//classValues: [0, 1] dice: existen dos clases posibles (0 = sin dato, 1 = con dato).
//classPoints: [0, numSamples] define cuántos puntos tomar de cada clase — 0 puntos de la clase 0 (vacíos) y 1000 puntos de la clase 1 (donde sí hay GEDI). 
// Asegurando que las muetras  caigan exactamente donde hay información real.
//dropNulls: true: descarta cualquier muestra que, a pesar de todo, tenga algún valor nulo en alguna banda.
//tileScale: 16: parámetro técnico de rendimiento, divide el cálculo en tareas más pequeñas para evitar que el servidor de GEE se quede sin memoria.
//

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

print('Número de features extraídas', training.size());
print('Feature de entrenamiento (ejemplo)', training.first());

// =========================================================================
// 6. Entrenar modelo de regresión
// =========================================================================

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

// Calcular RMSE
var calculateRmse = function(input) {
  var observed = ee.Array(
    input.aggregate_array('agbd'));
  var predicted = ee.Array(
    input.aggregate_array('agbd_predicted'));
  var rmse = observed.subtract(predicted).pow(2)
    .reduce('mean', [0]).sqrt().get([0]);
  return rmse;
};
var rmse = calculateRmse(predicted);
print('RMSE', rmse);

// Gráfico de valores observados vs. predichos
var chart = ui.Chart.feature.byFeature({
  features: predicted.select(['agbd', 'agbd_predicted']),
  xProperty: 'agbd',
  yProperties: ['agbd_predicted'],
}).setChartType('ScatterChart')
  .setOptions({
    title: 'Densidad de Biomasa Aérea - Bahía Málaga (Mg/Ha)',
    dataOpacity: 0.8,
    hAxis: { 'title': 'Observado' },
    vAxis: { 'title': 'Predicho' },
    legend: { position: 'right' },
    series: {
      0: {
        visibleInLegend: false,
        color: '#525252',
        pointSize: 3,
        pointShape: 'triangle',
      },
    },
    trendlines: {
      0: {
        type: 'linear',
        color: 'black',
        lineWidth: 1,
        pointSize: 0,
        labelInLegend: 'Ajuste Lineal',
        visibleInLegend: true,
        showR2: true
      }
    },
    chartArea: { left: 100, bottom: 100 },
  });
print(chart);

// =========================================================================
// 7. Generar predicciones
// =========================================================================

var predictedImage = stackedResampled.classify({
  classifier: model,
  outputName: 'agbd'
});

// =========================================================================
// 8. Exportar la imagen con valores predichos
// =========================================================================
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

// Espera a que termine de exportar
// Visualizae la imagen exportada.
var predictedImage = ee.Image(predictedExportImagePath);

var gediVis = {
  min: 0,
  max: 200,
  palette: ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'],
  bands: ['agbd']
};

Map.addLayer(predictedImage, gediVis, 'AGBD Predicho - Bahía Málaga');

// =========================================================================
// 9. Estimar la biomasa total
// =========================================================================
// Usamos ESA WorldCover v200 para seleccionar coberturas
// de vegetación (incluye la clase 95: Manglares)
var worldcover = ee.ImageCollection('ESA/WorldCover/v200').first();

var worldcoverResampled = worldcover
  .reduceResolution({
    reducer: ee.Reducer.mode(),
    maxPixels: 1024
  })
  .reproject({
    crs: gridProjection
  });

// | Clase       | Valor |
// | Bosques     | 10    |
// | Arbustos    | 20    |
// | Pastizales  | 30    |
// | Cultivos    | 40    |
// | Manglares   | 95    |
var landCoverMask = worldcoverResampled.eq(10)
  .or(worldcoverResampled.eq(20))
  .or(worldcoverResampled.eq(30))
  .or(worldcoverResampled.eq(40))
  .or(worldcoverResampled.eq(95));

var predictedImageMasked = predictedImage
  .updateMask(landCoverMask);
Map.addLayer(predictedImageMasked, gediVis, 'AGBD Predicho (Enmascarado)');

// =========================================================================
// 10. Calcular la Biomasa Total
// =========================================================================
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