// ////////////////////////////////////////////////////////////////////////////////
// // Taller: Regional Biodiversity Workshop
// // Autora: Wilpa
// // Objetivo: detecta perdida de bosque dentro de un area de interes (AOI), comparando dos "resumenes" anuales del terreno generados
//              por un modelo de inteligencia artificial (embeddings satelitales de Google), restringidos a una mascara de bosque para
//              distinguir perdida de ganancia, y valida ese resultado contra un producto especializado e independiente de perdida de
//              cobertura forestal (Hansen Global Forest Change).
// ////////////////////////////////////////////////////////////////////////////////

// -------------------------------------------------------------
// PARTE 1: Area de interes (AOI)
// -------------------------------------------------------------
// Aca se elige la zona de estudio. Se puede trabajar a dos escalas:
// - Nivel "area protegida": usando la base de datos mundial de areas protegidas (WDPA), filtrando por nombre.
// - Nivel "pais": usando limites administrativos de paises (GAUL).
// Solo una de las dos lineas de "var area = ..." debe estar activa

var WDPA = ee.FeatureCollection('WCMC/WDPA/current/polygons');
var GAUL0 = ee.FeatureCollection('FAO/GAUL/2015/level0');

// NIVEL 1 (activo): Area protegida - Parque Nacional Chingaza
var area = WDPA.filter(ee.Filter.eq('NAME', 'Chingaza'));

// NIVEL 2 (inactivo): Pais completo - Colombia
//var area = GAUL0.filter(ee.Filter.eq('ADM0_NAME', 'Colombia'));

// .geometry() extrae solo la forma geografica (el poligono), que es lo que necesitan la mayoria de las funciones de GEE para recortar y filtrar.
var geometry = area.geometry();

// AOI de proceso: el AOI original agrandado hacia afuera. Todo el analisis se hace sobre esta version mas grande; recien al final se
// recorta al AOI original (geometry).
var distanciaBufferProceso = 500;
var geometryProceso = geometry.buffer(distanciaBufferProceso);

// -------------------------------------------------------------
// PARTE 2: Cargar el dataset de embeddings y elegir los anios a comparar
// -------------------------------------------------------------
// Un "embedding" es un resumen numerico (64 numeros por pixel) que el modelo de IA de Google calcula a partir de varias fuentes satelitales
// (optico, radar, elevacion, series de tiempo) para describir como es esa porcion de terreno ese anio. Comparar los 64 numeros de un mismo
// pixel entre dos anios permite saber si el terreno cambio.
var dataset = ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL');

var year1 = 2020; // anio "antes"
var year2 = 2024; // anio "despues"

// Funcion que arma la imagen de embeddings de UN anio para el AOI de proceso (el agrandado). Se usa mosaic() (no first()) porque el AOI
// puede caer en mas de una tile del dataset; mosaic() une todas las que tocan el AOI para no dejar huecos sin datos.
function obtenerEmbedding(anio) {
  return dataset
    .filterDate(anio + '-01-01', (anio + 1) + '-01-01')
    .filterBounds(geometryProceso)
    .mosaic()
    .clip(geometryProceso);
}

var image1 = obtenerEmbedding(year1);
var image2 = obtenerEmbedding(year2);

// -------------------------------------------------------------
// PARTE 3: Calcular que tan parecidos son los dos anios (similitud)
// -------------------------------------------------------------
// Cada pixel tiene un vector de 64 numeros de longitud 1 (vector unitario). Multiplicar los dos vectores (uno de cada anio) numero a
// numero, y sumar los 64 resultados, da el "producto punto", que para vectores unitarios equivale matematicamente al coseno del angulo entre ellos:
//   1.0  = vectores identicos      -> el pixel no cambio
//   0.0  = vectores muy distintos  -> el pixel cambio mucho
var dotProd = image1.multiply(image2).reduce(ee.Reducer.sum())
  .rename('similitud');

// -------------------------------------------------------------
// PARTE 4: Mascara de bosque (ESA WorldCover 2020)
// -------------------------------------------------------------
// La similitud sola no distingue ganancia de perdida (un pixel que gana vegetacion y uno que la pierde dan la misma senial de "cambio"),
// asi que se restringe la busqueda a pixeles que ya eran bosque en year1: ahi un cambio detectado solo puede ser perdida o degradacion.
// Se usa ESA WorldCover v100 2020 (10 m, misma resolucion nativa que los embeddings) en vez de reconstruir el bosque desde Hansen, porque
// es un mapa de cobertura real fechado en 2020, no una aproximacion indirecta. Clase 10 del band 'Map' = "Tree cover".
// Nota: si se cambia year1 a un anio distinto de 2020, hay que buscar un dataset de cobertura de ese anio (WorldCover solo tiene 2020 y 2021).
var worldCover2020 = ee.Image('ESA/WorldCover/v100/2020').select('Map');
var mascaraBosqueYear1 = worldCover2020.eq(10).clip(geometryProceso).rename('mascara_bosque_year1');

// -------------------------------------------------------------
// PARTE 5: Convertir la similitud en perdida detectada, restringida a la mascara de bosque
// -------------------------------------------------------------
// Se necesita un numero de corte (umbral): por debajo de ese valor de similitud, se considera que el pixel cambio. No existe un umbral
// universal valido para todos los ecosistemas: se recomienda ajustarlo mirando el histograma de "dotProd" y comparando visualmente contra
// imagenes Sentinel-2 antes de darlo por definitivo.
var umbralSimilitud = 0.8;

var perdidaEmbeddings = dotProd.lt(umbralSimilitud)
  .updateMask(mascaraBosqueYear1)
  // selfMask() oculta los pixeles en 0 (sin cambio) y deja visibles / medibles solo los pixeles en 1 (con perdida detectada).
  .selfMask()
  .rename('perdida_embeddings');

// -------------------------------------------------------------
// PARTE 6: Comparar contra Hansen Global Forest Change (validacion)
// -------------------------------------------------------------
// Hansen GFC es un producto especializado que SOLO detecta un tipo de cambio: perdida de cobertura arborea por tala rasa. No detecta
// degradacion gradual dentro del bosque, que si puede bajar la similitud de los embeddings sin llegar a tala rasa. Por eso NO se espera
// que coincidan al 100%; sirve como referencia parcial para validar el umbral elegido. Se usa la misma mascara de bosque (WorldCover 2020)
// de la Parte 4 para que ambos metodos busquen perdida sobre exactamente el mismo dominio.
var gfc = ee.Image('UMD/hansen/global_forest_change_2024_v1_12');
var lossAnioYear1 = year1 - 2000;
var lossAnioFin = year2 - 2000;

var perdidaBosqueBool = gfc.select('lossyear')
  .gte(lossAnioYear1 + 1) // perdida ocurrida despues de year1, misma ventana que perdidaEmbeddings
  .and(gfc.select('lossyear').lte(lossAnioFin))
  .and(mascaraBosqueYear1)
  .clip(geometryProceso);

var perdidaBosque = perdidaBosqueBool.selfMask().rename('perdida_bosque_hansen');

// -------------------------------------------------------------
// PARTE 7: Donde coinciden los dos metodos
// -------------------------------------------------------------
// multiply() entre dos capas de 0/1 da 1 solo donde AMBAS marcan perdida; selfMask() oculta el resto para poder visualizarlo y medirlo por separado.
var coincidencia = perdidaEmbeddings.multiply(perdidaBosqueBool)
  .selfMask()
  .rename('coincidencia');

// -------------------------------------------------------------
// PARTE 8: Recortar todo al AOI ORIGINAL antes de mostrar resultados
// -------------------------------------------------------------
// Hasta aca, todas las capas cubren el AOI agrandado (geometryProceso).
// Recien ahora se recorta cada una al AOI original (geometry) -- este es el unico lugar del script donde se vuelve al limite real del parque.
var dotProdFinal = dotProd.clip(geometry);
var mascaraBosqueYear1Final = mascaraBosqueYear1.clip(geometry);
var perdidaEmbeddingsFinal = perdidaEmbeddings.clip(geometry);
var perdidaBosqueFinal = perdidaBosque.clip(geometry);
var coincidenciaFinal = coincidencia.clip(geometry);

// -------------------------------------------------------------
// PARTE 9: Visualizacion (usa las versiones YA recortadas al AOI original)
// -------------------------------------------------------------
var visEmbeddings = {min: -0.3, max: 0.3, bands: ['A01', 'A16', 'A09']};
//Map.addLayer(image1.clip(geometry), visEmbeddings, 'Embeddings ' + year1, false);
//Map.addLayer(image2.clip(geometry), visEmbeddings, 'Embeddings ' + year2, false);

Map.addLayer(
  dotProdFinal,
  {min: 0, max: 1, palette: ['white', 'black']},
  'Similitud entre anios (mas oscuro = mas distinto)',
  false
);

Map.addLayer(mascaraBosqueYear1Final, {palette: ['1a9850']}, 'Mascara de bosque (year1)', false);
Map.addLayer(perdidaEmbeddingsFinal, {palette: ['ff0000']}, 'Perdida detectada (embeddings, dentro de bosque)');
Map.addLayer(perdidaBosqueFinal, {palette: ['ff8c00']}, 'Perdida de bosque (Hansen GFC)');
Map.addLayer(coincidenciaFinal, {palette: ['ff00ff']}, 'Coincidencia embeddings + Hansen');

// -------------------------------------------------------------
// PARTE 10: Calcular areas (hectareas) y porcentajes de concordancia
// -------------------------------------------------------------
// ee.Image.pixelArea() da el area de cada pixel en metros cuadrados; se divide por 10 000 para convertir a hectareas. Todas las sumas de
// area usan las capas YA recortadas al AOI original y geometry.bounds() (no geometryProceso.bounds()), para que las estadisticas reflejen
// unicamente el parque real, no el area agrandada de proceso.
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

print('--- Perdida de bosque: embeddings (restringido a mascara) vs Hansen GFC (' + year1 + '-' + year2 + ') ---');
print('Area de bosque en year1, dominio de busqueda (ha):', areaBosqueYear1Ha);
print('Area con perdida detectada por embeddings (ha):', areaPerdidaEmbeddingsHa);
print('Area con perdida de bosque segun Hansen (ha):', areaPerdidaBosqueHa);
print('Area de coincidencia entre ambos (ha):', areaCoincidenciaHa);

// ee.Algorithms.If evita que el script falle (division por cero) si alguna de las areas de referencia da 0 dentro del AOI.
print('% de la perdida Hansen capturada por embeddings:',
  ee.Algorithms.If(
    ee.Number(areaPerdidaBosqueHa).gt(0),
    ee.Number(areaCoincidenciaHa).divide(areaPerdidaBosqueHa).multiply(100),
    'sin perdida de bosque registrada en el AOI'
  ));
print('% de la perdida de embeddings explicada por perdida de bosque (Hansen):',
  ee.Algorithms.If(
    ee.Number(areaPerdidaEmbeddingsHa).gt(0),
    ee.Number(areaCoincidenciaHa).divide(areaPerdidaEmbeddingsHa).multiply(100),
    'sin perdida detectada por embeddings en el AOI'
  ));

// -------------------------------------------------------------
// PARTE 11: Centrar el mapa
// -------------------------------------------------------------
Map.centerObject(geometry, 9);
Map.setOptions('HYBRID');