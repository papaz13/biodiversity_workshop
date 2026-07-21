/**** Start of imports. If edited, may not auto-convert in the playground. ****/
var samples = 
    /* color: #98ff00 */
    /* shown: false */
    ee.Geometry.MultiPoint(
        [[-73.75230839090514, 4.52935394628369],
         [-73.71282627420592, 4.5735029165576435]]);
/***** End of imports. If edited, may not auto-convert in the playground. *****/
////////////////////////////////////////////////////////////////////////////////
// Taller: Regional Biodiversity Workshop
// Autor: Wilpa
// Objetivo: identificar áreas dentro de un AOI cuyo perfil ecológico (según
// Satellite Embeddings de AlphaEarth) es similar a uno o varios puntos de
// referencia dibujados por el usuario. Insumo exploratorio para Meta 2
// (restauración: localizar análogos a sitios de referencia en buen estado)
// y Meta 4 (especies: screening de hábitat potencial similar a registros
// conocidos).
// Asset: GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL + WCMC/WDPA/current/polygons
////////////////////////////////////////////////////////////////////////////////

//--------------------------------------------------------------
// 1. Área de estudio (AOI) - parametrizable
//--------------------------------------------------------------
var areasProtegidas = ee.FeatureCollection('WCMC/WDPA/current/polygons');
var paises = ee.FeatureCollection('FAO/GAUL/2015/level0');

// NIVEL 1 (activo): Área protegida - Parque Nacional Chingaza
var areaEstudio = areasProtegidas.filter(ee.Filter.eq('NAME', 'Chingaza'));

// NIVEL 2 (inactivo): País completo - Colombia
// var areaEstudio = paises.filter(ee.Filter.eq('ADM0_NAME', 'Colombia'));

var geometria = areaEstudio.geometry();

Map.centerObject(geometria, 8);
Map.setOptions('SATELLITE');
Map.addLayer(geometria, {color: 'red'}, 'Área de búsqueda', false);

//--------------------------------------------------------------
// 2. Puntos de referencia dibujados por el usuario
//--------------------------------------------------------------
// IMPORTANTE: 'samples' debe crearse en el panel de
// "Geometry Imports" con la configuración:
//   Tipo de geometría: MultiPoint
//   Import as: Geometry
// Cada clic sobre el mapa agrega una coordenada al mismo objeto MultiPoint.
var muestras = ee.FeatureCollection(
  samples.coordinates().map(function (coordenadas) {
    return ee.Feature(ee.Geometry.Point(coordenadas));
  })
);

Map.addLayer(muestras, {color: 'yellow'}, 'Puntos de referencia');
print('Número de puntos de referencia dibujados:', muestras.size());

//--------------------------------------------------------------
// 3. Periodo de análisis
//--------------------------------------------------------------
var anio = 2024;
var fechaInicio = ee.Date.fromYMD(anio, 1, 1);
var fechaFin = fechaInicio.advance(1, 'year');

//--------------------------------------------------------------
// 4. Cargar el mosaico de embeddings para el año elegido
//--------------------------------------------------------------
var coleccionEmbeddings = ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL');

// Mosaico completo (SIN recortar), usado para extraer el vector de
// referencia en los puntos de muestra, aunque estén fuera del AOI.
var mosaicoCompleto = coleccionEmbeddings
  .filter(ee.Filter.date(fechaInicio, fechaFin))
  .mosaic();

// Mosaico recortado al AOI, usado para la búsqueda de similitud.
var mosaico = mosaicoCompleto.clip(geometria);

var escala = 10; // resolución nativa del dataset
var nombresBandas = mosaico.bandNames();

//--------------------------------------------------------------
// 5. Extraer el vector de embedding en cada punto de referencia
//--------------------------------------------------------------
var embeddingsMuestreados = mosaicoCompleto.sampleRegions({
  collection: muestras,
  scale: escala,
  tileScale: 4
});

//--------------------------------------------------------------
// 6. Calcular similitud (producto punto = coseno del ángulo)
//--------------------------------------------------------------
// Vectores unitarios -> producto punto = coseno del ángulo:
//   cercano a  1 -> muy similar
//   cercano a  0 -> sin relación
//   cercano a -1 -> muy distinto
var imagenesSimilitud = ee.ImageCollection(embeddingsMuestreados.map(function (feature) {
  var vectorReferencia = ee.Image(feature.toArray(nombresBandas)).arrayFlatten([nombresBandas]);
  var similitud = vectorReferencia.multiply(mosaico)
    .reduce('sum')
    .rename('similitud');
  return similitud;
}));

var similitudPromedio = imagenesSimilitud.mean().clip(geometria);

//--------------------------------------------------------------
// 7. Visualización
//--------------------------------------------------------------
var paleta = [
  '000004', '2C105C', '711F81', 'B63679',
  'EE605E', 'FDAE78', 'FCFDBF', 'FFFFFF'
];
var visualizacionSimilitud = {palette: paleta, min: -1, max: 1};
Map.addLayer(similitudPromedio, visualizacionSimilitud,
  'Similitud (blanco = más similar)');

//--------------------------------------------------------------
// 8. Umbral y vectorización de coincidencias
//--------------------------------------------------------------
var umbral = 0.85; // más alto = criterio más estricto
var mascaraCoincidencias = similitudPromedio.gt(umbral);

// Escala de vectorización más gruesa que la de muestreo (10 m),
// para evitar exceder maxPixels en AOIs grandes.
var escalaVectorizacion = 30;

var poligonosCoincidencias = mascaraCoincidencias.selfMask().reduceToVectors({
  scale: escalaVectorizacion,
  eightConnected: false,
  maxPixels: 1e10,
  bestEffort: true,
  tileScale: 4,
  geometry: geometria,
  geometryType: 'polygon'
});

var centroidesCoincidencias = poligonosCoincidencias.map(function (feature) {
  return feature.centroid({maxError: 1});
});

//--------------------------------------------------------------
// 9. Visualización de resultados vectorizados
//--------------------------------------------------------------
// Para AOIs grandes (país completo), comentar estas dos capas y usar
// primero la exportación (paso 10); luego cargar el asset ya exportado
// para visualizar sin recomputar.
Map.addLayer(poligonosCoincidencias, {color: 'cyan'}, 'Polígonos similares');
Map.addLayer(centroidesCoincidencias, {color: 'orange'}, 'Centroides candidatos');

print('Número de coincidencias encontradas:', poligonosCoincidencias.size());

//--------------------------------------------------------------
// 10. Exportar resultados (opcional)
//--------------------------------------------------------------
var etiquetaArea = 'Chingaza'; // ajustar según el AOI activo (paso 1)

// Export.table.toAsset({
//   collection: poligonosCoincidencias,
//   description: 'coincidencias_similitud_' + etiquetaArea + '_' + anio,
//   assetId: 'projects/TU_PROYECTO/assets/coincidencias_similitud_' + etiquetaArea + '_' + anio
// });

// Export.table.toDrive({
//   collection: centroidesCoincidencias,
//   description: 'centroides_similitud_' + etiquetaArea + '_' + anio,
//   folder: 'GEE_exports',
//   fileFormat: 'CSV'
// });

// Export.image.toDrive({
//   image: similitudPromedio,
//   description: 'raster_similitud_' + etiquetaArea + '_' + anio,
//   region: geometria,
//   scale: escala,
//   maxPixels: 1e13
// });