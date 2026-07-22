---
layout: page
title: 02_Similitud_Habitat_Embeddings
parent: "Introducción a Embedding"
nav_order: 2
---

## 02_Similitud_Habitat_Embeddings

# Objetivos

Identificar áreas dentro de un AOI cuyo perfil ecológico (según Satellite Embeddings de AlphaEarth) es similar a uno o varios puntos de referencia dibujados por el usuario. Es un insumo exploratorio para la Meta 2 del Marco Mundial de Biodiversidad Kunming-Montreal (restauración: localizar análogos a sitios de referencia en buen estado) y la Meta 4 (especies: screening de hábitat potencial similar a registros conocidos).

## Datos

- **`GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`** — Embeddings satelitales anuales (Google AlphaEarth).<br>
Collection: `ee.ImageCollection("GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL")`
- **`WCMC/WDPA/current/polygons`** — Base de Datos Mundial de Áreas Protegidas (WDPA), para el AOI a escala área protegida.<br>
Collection: `ee.FeatureCollection("WCMC/WDPA/current/polygons")`
- **`FAO/GAUL/2015/level0`** — Límites administrativos nacionales, para el AOI a escala país.<br>
Collection: `ee.FeatureCollection("FAO/GAUL/2015/level0")`

## Métodos

1. Embeddings satelitales y similitud por producto punto (coseno)
2. Muestreo de imagen en puntos (`sampleRegions`)
3. Álgebra de arrays (`toArray`, `arrayFlatten`)
4. Umbralización y vectorización de ráster (`reduceToVectors`)
5. Entradas de geometría dibujadas por el usuario (Geometry Imports)

## Paso a paso
## Paso 1: Área de estudio (AOI), parametrizable

Se define el AOI de dos formas posibles (área protegida o país). A diferencia de otros scripts del taller, acá el AOI no se agranda con un buffer de proceso: la búsqueda de similitud no depende de vecindad de píxeles, así que no hace falta ese margen.

```javascript
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
```

**Parámetros:**
- **`areasProtegidas.filter(ee.Filter.eq('NAME', 'Chingaza'))`**: Selecciona, dentro de la WDPA, el polígono cuyo atributo `NAME` coincide exactamente con `'Chingaza'`. Es la opción de AOI puntual (un parque).
- **`paises.filter(ee.Filter.eq('ADM0_NAME', 'Colombia'))` (comentado)**: Alternativa de AOI a escala país. Solo una de las dos líneas `var areaEstudio = ...` debe estar activa a la vez.
- **`areaEstudio.geometry()`**: Extrae la forma geográfica del feature seleccionado, usada como región de búsqueda (`geometria`) en el resto del script.
- **`Map.centerObject(geometria, 8)`**: Centra el visor sobre el AOI. El segundo argumento (8) es el nivel de zoom inicial.
- **`Map.setOptions('SATELLITE')`**: Cambia la capa base del visor a imagen satelital pura (sin nombres de calles), útil como fondo neutro para interpretar la capa de similitud del Paso 7.
- **`Map.addLayer(geometria, {color: 'red'}, 'Área de búsqueda', false)`**: Agrega el contorno del AOI, oculto por defecto (`false`), como capa de referencia activable desde el panel Layers.

## Paso 2: Puntos de referencia dibujados por el usuario

Se convierte un objeto de geometría dibujado a mano en el editor (`samples`) en una `FeatureCollection` de puntos individuales, que sirven como sitios de referencia para la búsqueda de similitud.

```javascript
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
```

**Parámetros:**
- **`samples` (variable de importación, no declarada en el código)**: Objeto `ee.Geometry.MultiPoint` que el usuario crea manualmente en el panel "Geometry Imports" del editor de GEE, marcando uno o varios puntos sobre el mapa (por ejemplo, sitios de restauración exitosa o registros de presencia de una especie). El script asume que ya existe con ese nombre exacto y ese tipo de geometría; si no se configura como `MultiPoint`/`Geometry`, `samples.coordinates()` fallará o devolverá una estructura distinta.
- **`samples.coordinates()`**: Extrae, como una lista de pares `[lon, lat]`, todas las coordenadas que componen el `MultiPoint`.
- **`.map(function(coordenadas){ return ee.Feature(ee.Geometry.Point(coordenadas)); })`**: Convierte cada par de coordenadas en un `ee.Feature` individual con geometría de punto, para poder usarlos por separado en el muestreo del Paso 5.
- **`muestras.size()`**: Cuenta cuántos puntos de referencia se dibujaron; útil como verificación rápida de que el `MultiPoint` se importó correctamente antes de correr el resto del script.

## Paso 3: Periodo de análisis

Se define el año de referencia para el que se van a comparar los embeddings, tanto en los puntos de muestra como en el AOI.

```javascript
var anio = 2024;
var fechaInicio = ee.Date.fromYMD(anio, 1, 1);
var fechaFin = fechaInicio.advance(1, 'year');
```

**Parámetros:**
- **`anio = 2024`**: Año calendario cuyo mosaico de embeddings se va a usar. A diferencia de otros scripts del taller que comparan dos años, este script trabaja con un único año: busca similitud espacial (entre lugares), no cambio temporal (entre fechas).
- **`ee.Date.fromYMD(anio, 1, 1)`**: Construye la fecha 1 de enero del año elegido, del lado del servidor de GEE.
- **`fechaInicio.advance(1, 'year')`**: Suma un año a la fecha de inicio, generando el límite superior del filtro de fecha (1 de enero del año siguiente), de forma que el rango cubra el año calendario completo sin depender de si es bisiesto.

## Paso 4: Cargar el mosaico de embeddings para el año elegido

Se arman dos versiones del mosaico de embeddings del año elegido: una completa, sin recortar, y otra recortada al AOI. Mantener ambas versiones es intencional y se explica en el paso siguiente.

```javascript
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
```

**Parámetros:**
- **`coleccionEmbeddings.filter(ee.Filter.date(fechaInicio, fechaFin))`**: Filtra la colección de embeddings para quedarse solo con las imágenes del año elegido. `ee.Filter.date()` es equivalente a `.filterDate()`, expresado como filtro explícito.
- **`.mosaic()`**: Une todas las tiles del dataset que caen dentro del rango de fecha en una sola imagen continua, sin recorte todavía. Se usa `mosaic()` (no `.first()`) porque el dataset está dividido en tiles y una sola imagen no necesariamente cubre toda el área de interés.
- **`mosaicoCompleto` (sin `.clip()`)**: Se conserva deliberadamente sin recortar porque los puntos de referencia (`muestras`, Paso 2) pueden estar dibujados fuera del AOI —por ejemplo, un sitio de restauración exitosa en otra región que se usa como referencia para buscar análogos dentro del AOI—. Si se recortara primero, el muestreo del Paso 5 devolvería valores vacíos para cualquier punto fuera del polígono.
- **`mosaico = mosaicoCompleto.clip(geometria)`**: Versión recortada al AOI, que es la que se usa para calcular la imagen de similitud (Paso 6): la búsqueda de "dónde se parece" solo tiene sentido dentro del área de estudio.
- **`escala = 10`**: Resolución nativa en metros del dataset de embeddings; se usa como `scale` tanto en el muestreo (Paso 5) como en la exportación del ráster (Paso 10).
- **`mosaico.bandNames()`**: Lista (del lado del servidor) con los nombres de las 64 bandas de embedding (A00 a A63). Se reutiliza en el Paso 6 para reconstruir el vector de referencia como imagen.

## Paso 5: Extraer el vector de embedding en cada punto de referencia

Se muestrea el mosaico completo (sin recortar) en la ubicación exacta de cada punto de referencia, obteniendo su vector de 64 valores de embedding.

```javascript
var embeddingsMuestreados = mosaicoCompleto.sampleRegions({
  collection: muestras,
  scale: escala,
  tileScale: 4
});
```

**Parámetros:**
- **`mosaicoCompleto.sampleRegions({...})`**: Extrae, para cada feature de `collection`, los valores de todas las bandas de la imagen en su ubicación, y los agrega como propiedades numéricas al feature. El resultado es una `FeatureCollection` con un feature por punto de referencia, cada uno con 64 propiedades (una por banda de embedding).
- **`collection: muestras`**: Los puntos donde se va a muestrear; la `FeatureCollection` construida en el Paso 2.
- **`scale: escala`**: Resolución del muestreo (10 m), la misma resolución nativa del dataset, para no perder ni promediar información al extraer el vector.
- **`tileScale: 4`**: Reparte el cálculo en teselas más pequeñas para reducir el riesgo de errores de memoria del lado del servidor; relevante incluso con pocos puntos porque cada uno requiere leer las 64 bandas del mosaico completo.

## Paso 6: Calcular similitud (producto punto = coseno del ángulo)

Por cada punto de referencia, se reconstruye su vector de embedding como una imagen de 64 bandas y se compara contra el mosaico del AOI, píxel por píxel. Si hay varios puntos de referencia, se promedian sus mapas de similitud individuales.

```javascript
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
```

**Parámetros:**
- **`embeddingsMuestreados.map(function(feature){...})`**: Recorre cada punto de referencia muestreado (Paso 5) y genera, por cada uno, una imagen de similitud completa sobre el AOI; el resultado se envuelve en una `ee.ImageCollection` con una imagen por punto.
- **`feature.toArray(nombresBandas)`**: Toma las 64 propiedades numéricas del feature (una por banda) y las empaqueta en un único valor de tipo `ee.Array`, en el orden indicado por `nombresBandas`.
- **`ee.Image(...)`**: Convierte ese `ee.Array` (un valor puntual del lado del servidor) en una imagen constante de una sola banda "array", necesaria para poder operar con `arrayFlatten` a continuación.
- **`.arrayFlatten([nombresBandas])`**: Reparte los 64 valores del array en 64 bandas normales, una por nombre en `nombresBandas`, generando así una imagen de embedding constante (el mismo vector repetido en cada píxel del AOI): el vector de referencia de ese punto, listo para compararse banda a banda contra `mosaico`.
- **`vectorReferencia.multiply(mosaico)`**: Multiplica, banda por banda, el vector de referencia (constante) contra el mosaico real del AOI (que varía píxel a píxel).
- **`.reduce('sum')`**: Suma las 64 bandas resultantes en un solo valor por píxel. Como ambos vectores son unitarios, esta suma equivale al producto punto entre ellos, que a su vez equivale al coseno del ángulo: cercano a 1 = perfil ecológico muy similar al punto de referencia; cercano a 0 = sin relación; cercano a -1 = perfil muy distinto (a diferencia de una comparación de cambio temporal, acá los valores negativos sí son posibles e interpretables).
- **`imagenesSimilitud.mean()`**: Si se dibujó más de un punto de referencia, promedia sus mapas de similitud individuales píxel por píxel, de forma que el resultado final refleje el parecido combinado a todos los sitios de referencia, no solo al primero.
- **`.clip(geometria)`**: Recorta el resultado final al AOI original.

## Paso 7: Visualización

Se muestra la capa de similitud continua en el mapa, con una paleta perceptualmente uniforme (tipo "magma") para distinguir con claridad los distintos niveles de similitud.

```javascript
var paleta = [
  '000004', '2C105C', '711F81', 'B63679',
  'EE605E', 'FDAE78', 'FCFDBF', 'FFFFFF'
];
var visualizacionSimilitud = {palette: paleta, min: -1, max: 1};
Map.addLayer(similitudPromedio, visualizacionSimilitud,
  'Similitud (blanco = más similar)');
```

**Parámetros:**
- **`paleta`**: Rampa de ocho colores hexadecimales, de oscuro (`'000004'`, casi negro) a claro (`'FFFFFF'`, blanco), similar a la paleta "magma" de matplotlib; perceptualmente uniforme, lo que evita que un tramo del rango visual domine falsamente la interpretación.
- **`visualizacionSimilitud = {palette: paleta, min: -1, max: 1}`**: Estira la paleta sobre el rango teórico completo del coseno del ángulo (-1 a 1), aunque en la práctica los valores muy negativos sean poco frecuentes; mantener ese rango fijo permite comparar visualmente distintos AOIs o distintos conjuntos de puntos de referencia bajo la misma escala de color.
- **`Map.addLayer(similitudPromedio, visualizacionSimilitud, 'Similitud (blanco = más similar)')`**: Agrega la capa continua de similitud al visor, visible por defecto.

## Paso 8: Umbral y vectorización de coincidencias

Se aplica un umbral de similitud para quedarse solo con los píxeles suficientemente parecidos a los puntos de referencia, y se convierte ese resultado ráster en polígonos vectoriales.

```javascript
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
```

**Parámetros:**
- **`umbral = 0.85`**: Valor de corte sobre la similitud promedio: por encima de 0.85 se considera que un píxel es ecológicamente análogo a los puntos de referencia. No existe un umbral universal; conviene ajustarlo revisando el histograma de `similitudPromedio` y comparando visualmente los polígonos resultantes contra el conocimiento de campo del área.
- **`similitudPromedio.gt(umbral)`**: Genera una imagen booleana: 1 donde la similitud supera el umbral, 0 en caso contrario.
- **`escalaVectorizacion = 30`**: Resolución usada solo para la vectorización, deliberadamente más gruesa que los 10 m de muestreo/similitud. Vectorizar a 10 m sobre un AOI grande puede generar una enorme cantidad de polígonos diminutos y exceder fácilmente `maxPixels`; 30 m reduce esa carga a costa de perder algo de detalle geométrico en el contorno de los polígonos.
- **`mascaraCoincidencias.selfMask()`**: Oculta los píxeles en 0 antes de vectorizar, para que `reduceToVectors` solo genere polígonos donde realmente hay coincidencia, en vez de generar también un polígono gigante cubriendo todo el "resto" del AOI.
- **`.reduceToVectors({...})`**: Convierte una imagen ráster en una `FeatureCollection` de polígonos, agrupando píxeles contiguos con el mismo valor.
- **`eightConnected: false`**: Define el criterio de contigüidad entre píxeles al agrupar: `false` usa conectividad de 4 vecinos (arriba, abajo, izquierda, derecha); `true` incluiría también los 4 vecinos diagonales, lo que tiende a fusionar más píxeles en un mismo polígono.
- **`maxPixels: 1e10` / `bestEffort: true` / `tileScale: 4`**: Límite máximo de píxeles a procesar, permiso para que GEE ajuste automáticamente la escala si el AOI es demasiado grande en vez de fallar, y reparto del cálculo en teselas más pequeñas para reducir el riesgo de errores de memoria, respectivamente.
- **`geometry: geometria`**: Región sobre la que se ejecuta la vectorización; el AOI original (no un rectángulo envolvente, a diferencia de otros scripts del taller, porque acá el resultado final son los polígonos mismos, no solo una estadística de área).
- **`geometryType: 'polygon'`**: Indica que cada grupo de píxeles conectados debe convertirse en un polígono (la alternativa más común es `'bb'`, que generaría en cambio el rectángulo envolvente de cada grupo).
- **`poligonosCoincidencias.map(function(feature){ return feature.centroid({maxError: 1}); })`**: Genera una segunda colección con el centroide de cada polígono de coincidencia, útil como lista de "puntos candidatos" fáciles de revisar en campo o de cruzar contra otras capas puntuales. `maxError: 1` es la tolerancia en metros para el cálculo del centroide.

## Paso 9: Visualización de resultados vectorizados

Se agregan al mapa los polígonos y centroides de coincidencia calculados en el paso anterior.

```javascript
// Para AOIs grandes (país completo), comentar estas dos capas y usar
// primero la exportación (paso 10); luego cargar el asset ya exportado
// para visualizar sin recomputar.
Map.addLayer(poligonosCoincidencias, {color: 'cyan'}, 'Polígonos similares');
Map.addLayer(centroidesCoincidencias, {color: 'orange'}, 'Centroides candidatos');

print('Número de coincidencias encontradas:', poligonosCoincidencias.size());
```

**Parámetros:**
- **`Map.addLayer(poligonosCoincidencias, {color: 'cyan'}, 'Polígonos similares')`**: Dibuja los polígonos de coincidencia en color cian, visibles por defecto.
- **`Map.addLayer(centroidesCoincidencias, {color: 'orange'}, 'Centroides candidatos')`**: Dibuja los centroides en naranja, superpuestos a los polígonos, para ubicarlos rápidamente incluso con el mapa alejado.
- **`poligonosCoincidencias.size()`**: Cuenta cuántos polígonos de coincidencia se generaron; sirve como verificación rápida de que el umbral del Paso 8 produjo un resultado razonable (ni vacío, ni prácticamente todo el AOI).
- **Nota de rendimiento (comentario del script)**: en un AOI grande (país completo), calcular y renderizar estas dos capas interactivamente puede ser lento o exceder los límites de cómputo del editor; el flujo recomendado en ese caso es exportar primero (Paso 10) y luego cargar el asset ya exportado como una capa liviana, en vez de recalcular la vectorización cada vez que se mueve el mapa.

## Paso 10: Exportar resultados (opcional)

Se dejan preparadas, pero comentadas, tres tareas de exportación a Google Drive o a un Asset de GEE: los polígonos de coincidencia, sus centroides, y el ráster continuo de similitud.

```javascript
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
```

**Parámetros:**
- **`etiquetaArea = 'Chingaza'`**: Texto que se concatena al nombre de cada tarea y archivo de exportación, para identificar a qué AOI corresponde. Debe actualizarse manualmente si se cambia el AOI activo en el Paso 1 (por ejemplo, a `'Colombia'` si se usa el nivel país).
- **`Export.table.toAsset({...})`**: Exporta los polígonos de coincidencia como un Asset de GEE (no a Drive), lo que permite reutilizarlos después como una capa liviana dentro del propio Earth Engine, sin recalcular la similitud. `assetId` debe reemplazar `'TU_PROYECTO'` por el ID real del proyecto de GEE del usuario.
- **`Export.table.toDrive({...})`**: Exporta los centroides como tabla a Google Drive, en formato CSV (con columnas de latitud/longitud implícitas en la geometría), útil para revisarlos en una hoja de cálculo o cargarlos en otro SIG.
- **`Export.image.toDrive({...})`**: Exporta el ráster continuo de similitud, usando `geometria` como región y `escala` (10 m) como resolución, coherente con la resolución nativa del dataset usada en el resto del script.
- **Bloques comentados**: Las tres exportaciones están comentadas por defecto porque son tareas pesadas (especialmente sobre un AOI a escala país) y deben iniciarse manualmente desde la pestaña "Tasks" del editor; descomentar solo la exportación que se necesite en cada corrida evita generar tareas innecesarias.

**Código completo:** [https://code.earthengine.google.com/58c046a7792a7a899e6eb2ea63d18ce4](https://code.earthengine.google.com/58c046a7792a7a899e6eb2ea63d18ce4)
