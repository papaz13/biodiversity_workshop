---
layout: page
title: 02_Species_Distribution_Models
parent: "Introducción AGB Biomass"
nav_order: 7
---

## 02_Species_Distribution_Models

Este script implementa un **Modelo de Distribución de Especies (SDM)** solo-presencia en Google Earth Engine, basado en el trabajo de Crego, Stabach y Connette (Smithsonian Conservation Biology Institute). A partir de registros de ocurrencia de una especie, genera pseudo-ausencias mediante perfilado ambiental, entrena un Random Forest con validación cruzada por bloques espaciales, y produce un mapa continuo de idoneidad de hábitat y un mapa binario de distribución potencial, ambos con sus métricas de precisión (AUC-ROC, AUC-PR, sensibilidad, especificidad).
 
## Objetivos
 
1. Cargar y depurar (rarefacer) registros de presencia de una especie.
2. Definir el área de interés y seleccionar variables ambientales predictoras (clima, terreno, cobertura arbórea).
3. Generar pseudo-ausencias mediante perfilado ambiental (K-medias) restringido espacialmente.
4. Construir una grilla de bloques espaciales para partición entrenamiento/validación (evita autocorrelación espacial).
5. Ajustar un modelo Random Forest en 10 iteraciones con semillas fijas, y promediar sus predicciones.
6. Calcular métricas de precisión (AUC-ROC, AUC-PR, sensibilidad, especificidad) y un umbral óptimo de corte.
7. Exportar los mapas finales (idoneidad de hábitat, distribución potencial, distribución con umbral) y las métricas a Google Drive.
## Datos
 
- **`users/ramirocrego84/BradypusVariegatus`** — Registros de presencia de la especie (ejemplo de caso de estudio).<br>
Collection: `ee.FeatureCollection('users/ramirocrego84/BradypusVariegatus')`
- **`WORLDCLIM/V1/BIO`** — Variables bioclimáticas (temperatura, precipitación y sus derivados).<br>
Image: `ee.Image("WORLDCLIM/V1/BIO")`
- **`USGS/SRTMGL1_003`** — Modelo digital de elevación (MDE), usado para derivar pendiente, orientación y elevación.<br>
Image: `ee.Image("USGS/SRTMGL1_003")`
- **`MODIS/006/MOD44B`** — Porcentaje de cobertura arbórea (mediana 2003-2020).<br>
Collection: `ee.ImageCollection("MODIS/006/MOD44B")`
- **`USDOS/LSIB_SIMPLE/2017`** — Límites de países, usado para recortar los productos finales al país de interés.<br>
Collection: `ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")`
> **Nota técnica:** los datos de presencia y las variables predictoras (`bands`) son intercambiables — este script es una plantilla genérica de SDM. Cualquier especie con registros de presencia geolocalizados y cualquier conjunto de covariables ambientales puede sustituir a `BradypusVariegatus` y a las seis bandas seleccionadas, siempre que se mantenga la resolución de trabajo (`GrainSize`) consistente entre presencias, pseudo-ausencias y predictores.
 
## Métodos
 
1. Rarefacción espacial de registros de presencia con un ráster aleatorio reproyectado a la resolución de trabajo (evita pseudoreplicación por agrupamiento de puntos).
2. Selección de variables predictoras y evaluación de colinealidad mediante correlación de Spearman por pares.
3. Generación de pseudo-ausencias por **perfilado ambiental**: agrupamiento K-medias (`ee.Clusterer.wekaKMeans`) sobre las variables predictoras, seleccionando como área válida el clúster ambientalmente opuesto al de los sitios de presencia.
4. Partición espacial mediante una grilla de bloques (`reduceToVectors` sobre una imagen de longitud × latitud), para separar entrenamiento y validación por bloques geográficos completos y no por puntos individuales — reduce el sesgo por autocorrelación espacial.
5. Clasificación con `ee.Classifier.smileRandomForest`, corrida en modo `PROBABILITY` (idoneidad continua) y en modo `CLASSIFICATION` (binario), repetida en 10 iteraciones con semillas fijas para reproducibilidad.
6. Ensamble de resultados: promedio de las 10 superficies de probabilidad (idoneidad de hábitat) y moda de las 10 clasificaciones binarias (mapa de distribución).
7. Evaluación de precisión con matrices de confusión a 25 umbrales de corte (0 a 1), cálculo de AUC-ROC y AUC-PR por integración trapezoidal, y selección del umbral que maximiza la suma de sensibilidad + especificidad.
## Paso 1 — Datos de presencia y rarefacción espacial
 
```javascript
// Cargar datos de presencia
var Data = ee.FeatureCollection('users/ramirocrego84/BradypusVariegatus');
print('Tamaño de datos original:', Data.size());
 
// Definir la resolución espacial de trabajo (en metros)
var GrainSize = 1000;
 
function RemoveDuplicates(data){
  var randomraster = ee.Image.random().reproject('EPSG:4326', null, GrainSize);
  var randpointvals = randomraster.sampleRegions({collection:ee.FeatureCollection(data), scale: 10, geometries: true});
  return randpointvals.distinct('random');
}
 
var Data = RemoveDuplicates(Data);
print('Tamaño de datos final:', Data.size());
```
 
**Parámetros:**
- **`GrainSize`** — resolución espacial (metros) de todo el flujo de trabajo. Debe coincidir con la resolución nativa o de trabajo de tus predictores más gruesos.
- **`RemoveDuplicates()`** — asigna un valor aleatorio por píxel de la grilla de trabajo y conserva un solo registro de presencia por píxel (`distinct('random')`), evitando que múltiples puntos cercanos infracalifiquen la varianza del modelo.
- **`scale: 10`** en `sampleRegions` — resolución fina de muestreo para asignar correctamente cada punto a su celda de la grilla aleatoria; no debe confundirse con `GrainSize`.
El script también crea dos mapas vinculados (`left`, `right`) para comparar capas de entrada y de salida en paralelo durante la exploración interactiva.
 
## Paso 2 — Área de interés (AOI)
 
```javascript
var AOI = Data.geometry().bounds().buffer({distance:50000, maxError:1000});
 
var countries = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017");
var pais = countries.filter(ee.Filter.eq('country_na', 'Colombia'));
```
 
**Parámetros:**
- **`buffer({distance:50000, ...})`** — amplía el rectángulo envolvente de los puntos de presencia en 50 km, para que el modelo tenga margen ambiental alrededor de los registros extremos.
- **`country_na`** — nombre del país en el dataset LSIB; usado únicamente para recortar los productos finales de exportación, no para restringir el modelado (el modelado corre sobre `AOI`).
## Paso 3 — Selección de variables predictoras
 
```javascript
var BIO = ee.Image("WORLDCLIM/V1/BIO");
var Terrain = ee.Algorithms.Terrain(ee.Image("USGS/SRTMGL1_003"));
var MODIS = ee.ImageCollection("MODIS/006/MOD44B");
var MedianPTC = MODIS.filterDate('2003-01-01', '2020-12-31').select(['Percent_Tree_Cover']).median();
 
var predictors = BIO.addBands(Terrain).addBands(MedianPTC);
 
var watermask = Terrain.select('elevation').gt(0);
var predictors = predictors.updateMask(watermask).clip(AOI);
 
var bands = ['bio04','bio05','bio06','bio12','elevation','Percent_Tree_Cover'];
var predictors = predictors.select(bands);
```
 
**Parámetros:**
- **`bands`** — subconjunto final de covariables: `bio04` (estacionalidad de temperatura), `bio05` (temperatura máxima del mes más cálido), `bio06` (temperatura mínima del mes más frío), `bio12` (precipitación anual), `elevation` y `Percent_Tree_Cover`. Este es el punto de edición principal si se cambian las variables ambientales del modelo.
- **`watermask`** — máscara binaria (`elevation > 0`) para excluir píxeles oceánicos antes del muestreo y del modelado.
- La correlación de Spearman por pares entre todas las bandas (`CorrAll`) se calcula pero no se imprime por defecto; se recomienda activar el `print()` correspondiente antes de fijar el conjunto final de `bands`, para descartar variables altamente colineales (|r| > 0.7 aprox.).
## Paso 4 — Pseudo-ausencias y bloques espaciales
 
```javascript
var mask = Data
  .reduceToImage({properties: ['random'], reducer: ee.Reducer.first()})
  .reproject('EPSG:4326', null, ee.Number(GrainSize)).mask().neq(1).selfMask();
 
// Perfilado ambiental (Opción 3, activa por defecto)
var PixelVals = predictors.sampleRegions({collection: Data.randomColumn().sort('random').limit(200), properties: [], tileScale: 16, scale: GrainSize});
var clusterer = ee.Clusterer.wekaKMeans({nClusters:2, distanceFunction:"Euclidean"}).train(PixelVals);
var Clresult = predictors.cluster(clusterer);
 
var clustID = Clresult.sampleRegions({collection: Data.randomColumn().sort('random').limit(200), properties: [], tileScale: 16, scale: GrainSize});
clustID = ee.FeatureCollection(clustID).reduceColumns(ee.Reducer.mode(),['cluster']);
clustID = ee.Number(clustID.get('mode')).subtract(1).abs();
var mask2 = Clresult.select(['cluster']).eq(clustID);
var AreaForPA = mask.updateMask(mask2).clip(AOI);
```
 
**Parámetros:**
- **`mask`** — excluye de las pseudo-ausencias cualquier píxel donde ya exista un registro de presencia, evitando contaminación entre clases.
- **`nClusters: 2`** — agrupa el paisaje en dos perfiles ambientales (similar / disímil a la presencia). El clúster **opuesto** al de la mayoría de los puntos de presencia (`clustID`, invertido con `.subtract(1).abs()`) define el área válida para generar pseudo-ausencias, siguiendo el principio de perfilado ambiental (evita generar "falsas ausencias" en sitios ambientalmente idénticos a la presencia).
- El script deja comentadas dos alternativas más simples: **Opción 1** (pseudo-ausencias aleatorias en toda el AOI) y **Opción 2** (restringidas a un búfer de distancia fija alrededor de la presencia). La Opción 3 (perfilado ambiental) es la más rigurosa y la que queda activa.
```javascript
function makeGrid(geometry, scale) {
  var lonLat = ee.Image.pixelLonLat();
  var lonGrid = lonLat.select('longitude').multiply(100000).toInt();
  var latGrid = lonLat.select('latitude').multiply(100000).toInt();
  return lonGrid.multiply(latGrid).reduceToVectors({
    geometry: geometry.buffer({distance:20000,maxError:1000}),
    scale: scale,
    geometryType: 'polygon',
  });
}
var Scale = 200000;
var grid = makeGrid(AOI, Scale);
var Grid = watermask.reduceRegions({collection: grid, reducer: ee.Reducer.mean()}).filter(ee.Filter.neq('mean',null));
```
 
**Parámetros:**
- **`Scale = 200000`** (200 km) — tamaño de celda de la grilla de bloques espaciales usada para la partición entrenamiento/validación (no confundir con `GrainSize`, que es la resolución de los predictores). Bloques más grandes reducen la autocorrelación espacial entre partición de entrenamiento y de prueba, a costa de menos bloques disponibles.
- El filtro `ee.Filter.neq('mean', null)` elimina celdas de la grilla que caen completamente en el océano (sin valores de `watermask`).
## Paso 5 — Ajuste del modelo (Random Forest, 10 iteraciones)
 
```javascript
function SDM(x) {
    var Seed = ee.Number(x);
    var GRID = ee.FeatureCollection(Grid).randomColumn({seed:Seed}).sort('random');
    var TrainingGrid = GRID.filter(ee.Filter.lt('random', split));
    var TestingGrid = GRID.filter(ee.Filter.gte('random', split));
 
    var PresencePoints = ee.FeatureCollection(Data).map(function(feature){return feature.set('PresAbs', 1)});
    var TrPresencePoints = PresencePoints.filter(ee.Filter.bounds(TrainingGrid));
    var TePresencePoints = PresencePoints.filter(ee.Filter.bounds(TestingGrid));
 
    var TrPseudoAbsPoints = AreaForPA.sample({region: TrainingGrid, scale: GrainSize, numPixels: TrPresencePoints.size().add(300), seed:Seed, geometries: true, tileScale: 16});
    TrPseudoAbsPoints = TrPseudoAbsPoints.randomColumn().sort('random').limit(ee.Number(TrPresencePoints.size()));
    TrPseudoAbsPoints = TrPseudoAbsPoints.map(function(feature){return feature.set('PresAbs', 0);});
 
    var TePseudoAbsPoints = AreaForPA.sample({region: TestingGrid, scale: GrainSize, numPixels: TePresencePoints.size().add(100), seed:Seed, geometries: true, tileScale: 16});
    TePseudoAbsPoints = TePseudoAbsPoints.randomColumn().sort('random').limit(ee.Number(TePresencePoints.size()));
    TePseudoAbsPoints = TePseudoAbsPoints.map(function(feature){return feature.set('PresAbs', 0);});
 
    var trainingPartition = TrPresencePoints.merge(TrPseudoAbsPoints);
    var testingPartition = TePresencePoints.merge(TePseudoAbsPoints);
 
    var trainPixelVals = predictors.sampleRegions({collection: trainingPartition, properties: ['PresAbs'], scale: GrainSize, tileScale: 16});
 
    var Classifier = ee.Classifier.smileRandomForest({
       numberOfTrees: 500, variablesPerSplit: null, minLeafPopulation: 10,
       bagFraction: 0.5, maxNodes: null, seed: Seed
      });
 
    var ClassifierPr = Classifier.setOutputMode('PROBABILITY').train(trainPixelVals, 'PresAbs', bands);
    var ClassifiedImgPr = predictors.select(bands).classify(ClassifierPr);
 
    var ClassifierBin = Classifier.setOutputMode('CLASSIFICATION').train(trainPixelVals, 'PresAbs', bands);
    var ClassifiedImgBin = predictors.select(bands).classify(ClassifierBin);
 
    return ee.List([ClassifiedImgPr, ClassifiedImgBin, trainingPartition, testingPartition]);
}
 
var split = 0.70;
var numiter = 10;
var results = ee.List([35,68,43,54,17,46,76,88,24,12]).map(SDM);
var results = results.flatten();
```
 
**Parámetros:**
- **`split = 0.70`** — proporción de bloques espaciales usados para entrenamiento (70%) vs. validación (30%).
- **`numiter = 10`** — número de corridas independientes del modelo, cada una con una partición espacial y un conjunto de pseudo-ausencias distintos, para estimar la variabilidad del resultado.
- **Semillas fijas (`[35,68,43,54,17,46,76,88,24,12]`)** — se usan en lugar de la función `runif()` (dejada comentada) para garantizar reproducibilidad exacta entre corridas del script.
- **`numberOfTrees: 500`, `minLeafPopulation: 10`, `bagFraction: 0.5`** — hiperparámetros del Random Forest. El script deja comentada una alternativa con `ee.Classifier.smileGradientTreeBoost` como algoritmo sustituto.
- **`ee.List([ClassifiedImgPr, ClassifiedImgBin, trainingPartition, testingPartition])`** — cada iteración retorna 4 elementos en este orden fijo; las secciones siguientes dependen de este orden para extraer resultados con `ee.List.sequence(...,4)`.
## Paso 6 — Idoneidad de hábitat y mapa de distribución
 
```javascript
var images = ee.List.sequence(0,ee.Number(numiter).multiply(4).subtract(1),4).map(function(x){return results.get(x)});
var ModelAverage = ee.ImageCollection.fromImages(images).mean();
var ModelAverage_CO = ModelAverage.clip(pais);
 
var images2 = ee.List.sequence(1,ee.Number(numiter).multiply(4).subtract(1),4).map(function(x){return results.get(x)});
var DistributionMap = ee.ImageCollection.fromImages(images2).mode();
var DistributionMap_CO = DistributionMap.clip(pais);
```
 
**Parámetros:**
- **`ee.List.sequence(0, ..., 4)`** — extrae de `results` los elementos en las posiciones 0, 4, 8... (las superficies de probabilidad de cada iteración), aprovechando que cada `SDM()` devuelve 4 elementos en orden fijo.
- **`ModelAverage`** — promedio de las 10 superficies de probabilidad: el mapa continuo de **idoneidad de hábitat**.
- **`DistributionMap`** (con `ee.List.sequence(1, ...)`) — moda (voto de mayoría) de las 10 clasificaciones binarias: el mapa de **distribución potencial**.
- Ambos productos se visualizan con leyendas dinámicas (`ui.Panel` con gradiente de color y umbrales Baja/Media/Alta para idoneidad; verde/blanco para presencia/ausencia en distribución).
## Paso 7 — Evaluación de precisión
 
```javascript
function getAcc(img,TP){
  var Pr_Prob_Vals = img.sampleRegions({collection: TP, properties: ['PresAbs'], scale: GrainSize, tileScale: 16});
  var seq = ee.List.sequence({start: 0, end: 1, count: 25});
  return ee.FeatureCollection(seq.map(function(cutoff) {
    var Pres = Pr_Prob_Vals.filterMetadata('PresAbs','equals',1);
    var TP =  ee.Number(Pres.filterMetadata('classification','greater_than',cutoff).size());
    var TPR = TP.divide(Pres.size());
    var Abs = Pr_Prob_Vals.filterMetadata('PresAbs','equals',0);
    var FN = ee.Number(Pres.filterMetadata('classification','less_than',cutoff).size());
    var TN = ee.Number(Abs.filterMetadata('classification','less_than',cutoff).size());
    var TNR = TN.divide(Abs.size());
    var FP = ee.Number(Abs.filterMetadata('classification','greater_than',cutoff).size());
    var FPR = FP.divide(Abs.size());
    var Precision = TP.divide(TP.add(FP));
    var SUMSS = TPR.add(TNR);
    return ee.Feature(null,{cutoff: cutoff, TP:TP, TN:TN, FP:FP, FN:FN, TPR:TPR, TNR:TNR, FPR:FPR, Precision:Precision, SUMSS:SUMSS});
  }));
}
```
 
**Parámetros:**
- **`seq` (25 cortes entre 0 y 1)** — cada uno se evalúa como umbral de clasificación binaria sobre la superficie de probabilidad, generando una matriz de confusión (TP, TN, FP, FN) por corte.
- **`TPR` (sensibilidad), `TNR` (especificidad), `Precision`, `SUMSS`** — métricas derivadas de la matriz de confusión en cada umbral; `SUMSS` (sensibilidad + especificidad) es la que luego se usa para elegir el umbral óptimo.
```javascript
function getAUCROC(x){
  var X = ee.Array(x.aggregate_array('FPR'));
  var Y = ee.Array(x.aggregate_array('TPR'));
  var X1 = X.slice(0,1).subtract(X.slice(0,0,-1));
  var Y1 = Y.slice(0,1).add(Y.slice(0,0,-1));
  return X1.multiply(Y1).multiply(0.5).reduce('sum',[0]).abs().toList().get(0);
}
```
 
**Parámetros:**
- **AUC-ROC** — se calcula por integración trapezoidal directa sobre los 25 puntos (FPR, TPR) de `getAcc()`, sin depender de librerías externas de curvas ROC.
- El mismo principio de integración trapezoidal se reutiliza en `getAUCPR()`, pero sobre el par (TPR, Precisión) en lugar de (FPR, TPR).
- **`getMetrics()`** selecciona, para cada iteración, la fila de `getAcc()` con el mayor `SUMSS`; el promedio de esos 10 umbrales óptimos (`MeanThresh`) es el umbral final usado para binarizar el mapa de idoneidad promedio.
## Paso 8 — Mapa binario con umbral óptimo
 
```javascript
var DistributionMap2 = ModelAverage.gte(MeanThresh);
```
 
**Parámetros:**
- A diferencia de `DistributionMap` (voto de mayoría de 10 clasificaciones binarias independientes), `DistributionMap2` aplica un único umbral (`MeanThresh`, el promedio de los 10 umbrales óptimos por `SUMSS`) directamente sobre `ModelAverage`. Son dos formas distintas y complementarias de binarizar el resultado.
## Paso 9 — Exportación de resultados
 
```javascript
Export.image.toDrive({
  image: ModelAverage_CO, description: 'HSI', scale: GrainSize, maxPixels: 1e10, region: pais
});
 
Export.image.toDrive({
  image: DistributionMap_CO, description: 'PotentialDistribution', scale: GrainSize, maxPixels: 1e10, region: pais
});
 
Export.image.toDrive({
  image: DistributionMap2.unmask(-9999), description: 'PotentialDistributionThreshold', scale: GrainSize, maxPixels: 1e10, region: pais
});
 
Export.table.toDrive({
  collection: ee.FeatureCollection(AUCROCs.map(function(element){return ee.Feature(null,{AUCROC:element})})),
  description: 'AUCROC', fileFormat: 'CSV',
});
 
Export.table.toDrive({
  collection: ee.FeatureCollection(AUCPRs.map(function(element){return ee.Feature(null,{AUCPR:element})})),
  description: 'AUCPR', fileFormat: 'CSV',
});
 
Export.table.toDrive({
  collection: ee.FeatureCollection(Metrics), description: 'Metrics', fileFormat: 'CSV',
});
```
 
**Parámetros:**
- **`unmask(-9999)`** — asigna un valor centinela a los píxeles sin datos (fuera de la máscara de agua/AOI) antes de exportar el mapa binario con umbral, para evitar ambigüedad entre "ausencia" y "sin datos" al reimportar el ráster en otro software.
- **`region: pais`** — todos los productos raster se recortan y exportan al límite del país (Colombia en el caso de estudio), no al AOI completo con el búfer de 50 km.
- El script también exporta los conjuntos de entrenamiento y validación de la primera iteración (`TrainingDatasets.get(0)`, `TestingDatasets.get(0)`) como CSV, útiles para auditar manualmente qué puntos se usaron en una corrida específica.
> **Nota de transcripción:** en la Sección 9 del script original hay dos bloques `Export.table.toDrive` consecutivos con el mismo `description: 'TestingDataRun1'` (uno exportando `TrainingDatasets.get(0)` y otro `TestingDatasets.get(0)`). Es un error de copiar/pegar en el nombre — Google Drive los diferenciará solo por sufijo numérico automático, sin indicar cuál es entrenamiento y cuál validación. Se recomienda renombrar el primero a `'TrainingDataRun1'` antes de ejecutar el script.

**Código completo:** 

Repositorio GEE [https://code.earthengine.google.com/?accept_repo=users/nleuro/SDM](https://code.earthengine.google.com/?accept_repo=users/nleuro/SDM) 
