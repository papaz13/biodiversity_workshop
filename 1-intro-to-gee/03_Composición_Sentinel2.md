---
layout: page
title: 03_Composición_Sentinel2
parent: "Introducción a GEE"
nav_order: 4
---

# 03_Composición_Sentinel2
## Objetivo
1. Definir un área de interés usando límites administrativos (FAO GAUL).
2. Filtrar, enmascarar nubes y calcular índices espectrales sobre una colección Sentinel-2.
3. Generar distintos tipos de composición (mediana, mosaico de calidad) y exportarlos.

## Datos
- Límites administrativos, nivel pais (level0) FAO, collection: `FAO/GAUL/2015/level0`
<p align="center">
  <img src="{{ '/images/intro-gee/fig11.png' | relative_url }}" width="600" style="margin: 10px 0;">
</p>

- Imágenes Sentinel-2, Nivel 2A (reflectancia de superficie), collection: `COPERNICUS/S2_SR`
<p align="center">
  <img src="{{ '/images/intro-gee/fig12.png' | relative_url }}" width="600" style="margin: 10px 0;">
</p>

## Método
- Enmascaramiento de nubes mediante la banda de calidad `QA60` y operadores de bits (`bitwiseAnd`).
- Cálculo de índices espectrales normalizados con `normalizedDifference()`.
- Aplicación de funciones a toda una colección mediante `.map()`.
- Composición de la serie temporal con `.median()` y `.qualityMosaic()`.
- Exportación de resultados a Google Drive y como GEE Asset.

## Paso a paso
## Paso 1: Definir el área de interés

Importar la colección de límites administrativos a nivel país y filtrarla con `ee.Filter.eq()` para obtener el feature de Colombia. Centrar el mapa sobre el resultado.

```javascript
var limites = ee.FeatureCollection('FAO/GAUL/2015/level0');
var area = limites.filter(
  ee.Filter.eq('ADM0_NAME', 'Colombia')
);

Map.centerObject(area, 9);
Map.addLayer(area, {}, 'Área de Interés', false);
```

**Parámetros:**
- **`limites.filter(ee.Filter.eq('ADM0_NAME', 'Colombia'))`**: Selecciona, dentro de la colección de países, el feature cuyo atributo `ADM0_NAME` sea exactamente `'Colombia'`.
- **`Map.centerObject(area, 9)`**: Centra el visor de mapa sobre el AOI. El segundo argumento (9) es el nivel de zoom inicial.
- **`Map.addLayer(area, {}, 'Área de Interés', false)`**: Agrega el contorno del AOI al mapa, oculto por defecto (`false`), como capa de referencia activable desde el panel Layers.

## Paso 2: Cargar y filtrar la colección Sentinel-2

Cargar `COPERNICUS/S2_SR_HARMONIZED` y filtrarla por ubicación (`.filterBounds()`), fecha (`.filterDate()`) y porcentaje de nubes (`ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20)`).

```javascript
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');

var s2filtrado = s2.filterBounds(area)
                   .filterDate('2025-01-01', '2026-01-01')
                   .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20));

print('Número de imágenes filtradas', s2filtrado.size());
```

**Parámetros:**
- **`ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')`**: Se usa la versión "harmonized" del catálogo Sentinel-2 SR (no `COPERNICUS/S2_SR` a secas, aunque así figura en la sección de Datos), que corrige un cambio de offset radiométrico que ESA introdujo en enero de 2022; con la versión harmonized, todas las escenas —anteriores y posteriores a ese cambio— quedan en la misma escala de valores.
- **`.filterBounds(area)`**: Descarta las escenas que no intersectan el AOI.
- **`.filterDate('2025-01-01', '2026-01-01')`**: Limita la colección a un año calendario específico.
- **`ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20)`**: Descarta escenas cuyo porcentaje de nubosidad global (metadato calculado por ESA sobre toda la escena, no por AOI) sea igual o mayor a 20%. Es un filtro grueso a nivel de escena completa; el enmascaramiento fino píxel a píxel ocurre después, en el Paso 3.
- **`s2filtrado.size()`**: Cuenta cuántas imágenes quedaron tras los tres filtros; útil para detectar temprano si el AOI, la fecha o el umbral de nubes dejaron la colección vacía.

> **Nota técnica — vigencia de la banda `QA60` según el rango de fechas:**
> - **Antes del 25 de enero de 2022:** `QA60` funciona normalmente.
> - **Entre el 25 de enero de 2022 y el 28 de febrero de 2024:** la banda `QA60` estuvo vacía (siempre en 0, "sin nubes"), incluso en escenas totalmente nubladas. Esto no genera un error de código, sino resultados incorrectos.
> - **Desde el 28 de febrero de 2024:** Google reconstruyó `QA60` de forma retroactiva a partir de otra banda (`MSK_CLASSI`), por lo que volvió a ser confiable para todo el historial de datos.
>
> **Recomendación:** para nuevos análisis, especialmente si se trabaja con fechas recientes o no se está seguro del rango temporal, considerar usar el dataset [`COPERNICUS/S2_CLOUD_PROBABILITY`](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_CLOUD_PROBABILITY) (basado en el algoritmo *s2cloudless*) en lugar de `QA60`, ya que es más robusto y no depende de estos cambios de procesamiento histórico de ESA.

**Opcional — verificar que las imágenes contengan la banda `QA60`:**

Antes de aplicar la función de enmascaramiento, filtrar la colección para conservar únicamente las imágenes que efectivamente contienen la banda `QA60`, usando `ee.Filter.listContains()`.

```javascript
s2filtrado = s2filtrado.filter(
  ee.Filter.listContains('system:band_names', 'QA60')
);
```

- **`ee.Filter.listContains('system:band_names', 'QA60')`**: `system:band_names` es un metadato de cada imagen con la lista de nombres de sus bandas; este filtro conserva solo las imágenes donde esa lista incluye `'QA60'`. Es una salvaguarda defensiva: dado el historial de cambios de la banda descrito en la nota técnica anterior, sirve para evitar que la función de enmascaramiento del Paso 3 falle sobre alguna imagen atípica que no la tenga.

## Paso 3: Preprocesamiento de la serie temporal (enmascaramiento de nubes y cálculo de índices)

Se definen dos funciones reutilizables —una para enmascarar nubes, otra para calcular índices espectrales— y se aplican a toda la colección filtrada con `.map()`.

**Función de enmascaramiento de nubes (`QA60`):** la banda de calidad `QA60` proporciona información sobre la ocurrencia de nubes y otros aspectos de calidad de imagen, almacenada en bits individuales; se usa `bitwiseAnd()` para extraer el valor de un bit específico.

```javascript
function mascaraNubesS2(imagen) {
  var qa = imagen.select('QA60');

  var bitmaskNubes = 1 << 10;
  var bitmaskCirrus = 1 << 11;

  var mascara = qa.bitwiseAnd(bitmaskNubes).eq(0)
      .and(qa.bitwiseAnd(bitmaskCirrus).eq(0));
  
  var bandas = imagen.select('B.').divide(10000);
  
  return imagen.addBands(bandas, null, true).updateMask(mascara);
}
```

**Parámetros:**
- **`imagen.select('QA60')`**: Extrae la banda de calidad, donde cada bit individual codifica un tipo distinto de condición atmosférica.
- **`bitmaskNubes = 1 << 10` / `bitmaskCirrus = 1 << 11`**: Construyen máscaras de bit que aíslan, respectivamente, el bit 10 (nubes densas) y el bit 11 (cirros) de `QA60`, mediante desplazamiento de bits (`1 << 10` es equivalente a 1024, un número con un único bit encendido en la posición 10).
- **`qa.bitwiseAnd(bitmaskNubes).eq(0)`**: `bitwiseAnd()` aplica un AND bit a bit entre el valor de `QA60` de cada píxel y la máscara; el resultado es distinto de 0 únicamente si ese bit específico estaba encendido. Comparar `.eq(0)` produce una imagen booleana: 1 donde el bit de nubes está apagado (píxel limpio), 0 donde está encendido (píxel nublado).
- **`.and(qa.bitwiseAnd(bitmaskCirrus).eq(0))`**: Combina esa condición con la equivalente para cirros; el resultado (`mascara`) es 1 solo donde ambos bits están apagados.
- **`imagen.select('B.')`**: Selección por expresión regular: `'B.'` coincide con cualquier nombre de banda que empiece con `B` seguido de un carácter (`B1`, `B2`, … `B12`), lo que selecciona las bandas espectrales y excluye a `QA60` y otras bandas auxiliares.
- **`.divide(10000)`**: Los productos Sentinel-2 SR almacenan reflectancia de superficie escalada como enteros (factor de escala 10 000); dividir convierte esos valores a reflectancia fraccional (0–1), unidad necesaria para que los índices espectrales del siguiente bloque den resultados correctamente acotados.
- **`imagen.addBands(bandas, null, true)`**: Reincorpora las bandas ya escaladas a la imagen original. El tercer argumento (`true`, *overwrite*) hace que las bandas nuevas reemplacen a las originales sin escalar (mismo nombre), en vez de agregarse duplicadas con sufijo.
- **`.updateMask(mascara)`**: Aplica la máscara de nubes/cirros calculada arriba: los píxeles nublados quedan sin dato en todas las bandas de la imagen resultante.

**Función para calcular índices**, usando `normalizedDifference()`:

| Índice | Fórmula |
|---|---|
| **NDVI** | (NIR − Red) / (NIR + Red) |
| **LSWI** | (NIR − SWIR1) / (NIR + SWIR1) |
| **NDMI** | (SWIR2 − Red) / (SWIR2 + Red) |

```javascript
function calcularIndices(imagen){
  var ndvi = imagen.normalizedDifference(['B8', 'B4']).rename('ndvi');
  var lswi = imagen.normalizedDifference(['B8', 'B11']).rename('lswi');
  var ndmi = imagen.normalizedDifference(['B12', 'B3']).rename('ndmi');
  var mndwi = imagen.normalizedDifference(['B3', 'B11']).rename('mndwi');
  
  return ee.Image.cat([imagen, ndvi, lswi, ndmi, mndwi]);
}
```

**Parámetros:**
- **`imagen.normalizedDifference([bandaA, bandaB])`**: Calcula `(bandaA − bandaB) / (bandaA + bandaB)` para cada par de bandas indicado, la operación estándar detrás de cualquier índice de diferencia normalizada.
- **`ndvi = normalizedDifference(['B8', 'B4'])`**: `B8` (infrarrojo cercano) y `B4` (rojo); coincide exactamente con la fórmula de la tabla.
- **`lswi = normalizedDifference(['B8', 'B11'])`**: `B8` (NIR) y `B11` (SWIR1); coincide con la fórmula de la tabla, y de hecho corresponde también a la definición estándar más común de NDMI (Normalized Difference Moisture Index) usada en la literatura, no solo a "LSWI".
- **`ndmi = normalizedDifference(['B12', 'B3'])`**: **Discrepancia con la tabla:** la tabla define NDMI como `(SWIR2 − Red) / (SWIR2 + Red)`, es decir, bandas `B12` y `B4`; el código, en cambio, usa `B12` (SWIR2) y `B3` (verde), no `B4` (rojo). Tal como está escrito, este índice no corresponde ni a la fórmula de la tabla ni a ninguna definición estándar de NDMI; conviene revisar si la banda correcta debería ser `B4` (para que coincida con la tabla) antes de usar esta salida en un análisis.
- **`mndwi = normalizedDifference(['B3', 'B11'])`**: Índice adicional, no listado en la tabla de fórmulas: `B3` (verde) y `B11` (SWIR1) es la definición estándar de MNDWI (Modified Normalized Difference Water Index), usado para resaltar cuerpos de agua.
- **`ee.Image.cat([imagen, ndvi, lswi, ndmi, mndwi])`**: Concatena las bandas originales de la imagen (ya enmascaradas y escaladas por `mascaraNubesS2`) junto con las cuatro bandas de índice recién calculadas, en una sola imagen de salida con todas las bandas juntas.

**Aplicar las funciones de preprocesamiento a toda la colección:**

```javascript
var s2preProcesado = s2filtrado.map(mascaraNubesS2)
                               .map(calcularIndices);

print(s2preProcesado.first());
```

- **`s2filtrado.map(mascaraNubesS2).map(calcularIndices)`**: Aplica primero el enmascaramiento de nubes y luego el cálculo de índices a cada imagen de la colección, de forma independiente por imagen. El orden importa: los índices se calculan sobre bandas ya escaladas a reflectancia (0–1) y con nubes enmascaradas.
- **`print(s2preProcesado.first())`**: Imprime la estructura (nombres de bandas, propiedades) de la primera imagen resultante, útil como verificación rápida de que el preprocesamiento agregó las bandas esperadas.

## Paso 4: Visualizar la primera imagen antes y después del preprocesamiento

Se comparan visualmente los rangos de valores de una imagen sin procesar y su versión preprocesada, con parámetros de visualización distintos porque están en escalas numéricas distintas.

```javascript
var primeraNoProcesada = s2filtrado.first();

var paramVisNoProcesada = {
  bands: ['B4', 'B3', 'B2'],
  min: -100,
  max: 1800
};

Map.addLayer(primeraNoProcesada, 
             paramVisNoProcesada, 
             'Primera Imagen No Procesada');

var primeraPreProcesada = s2preProcesado.first();

var paramVisPreProcesada = {
  bands: ['B4', 'B3', 'B2'],
  min: 0.0,
  max: 0.18
};

Map.addLayer(primeraPreProcesada, 
             paramVisPreProcesada, 
             'Primera Imagen Preprocesada');
```

**Parámetros:**
- **`bands: ['B4', 'B3', 'B2']`**: Combinación de bandas para composición en color verdadero (Red-Green-Blue), igual en ambas visualizaciones.
- **`paramVisNoProcesada = {min: -100, max: 1800}`**: Rango de visualización para la imagen sin procesar, cuyas bandas siguen en la escala entera original del producto SR (reflectancia × 10 000, con ocasionales valores negativos por corrección atmosférica); 1800 es un techo razonable para vegetación y suelo típicos, sin saturar el brillo.
- **`paramVisPreProcesada = {min: 0.0, max: 0.18}`**: Rango de visualización para la imagen ya dividida entre 10 000 en `mascaraNubesS2` (Paso 3), donde la reflectancia queda expresada como fracción (0–1); 0.18 cumple el mismo rol que 1800 en la versión sin procesar, solo que en la escala reducida.
- **Contraste entre ambas capas**: más allá de la diferencia de escala numérica, la imagen preprocesada también debería verse con menos (o ningún) píxel nublado visible, ya que ya pasó por `mascaraNubesS2`; es una forma visual rápida de confirmar que el enmascaramiento funcionó.

## Paso 5: Crear una composición

Se genera una composición de mediana de toda la serie preprocesada, recortada al AOI. Como alternativa, se muestra también cómo construir un mosaico de calidad basado en la imagen más reciente disponible por píxel.

```javascript
var composicion = s2preProcesado.median().clip(area);
Map.addLayer(composicion, paramVisPreProcesada, 'Composición Preprocesada');
```

**Parámetros:**
- **`s2preProcesado.median()`**: Colapsa toda la `ImageCollection` en una sola imagen, calculando la mediana píxel a píxel entre todas las observaciones válidas (no enmascaradas) de cada banda. Es una alternativa robusta frente a nubes residuales o valores atípicos: a diferencia del promedio, la mediana no se distorsiona por unos pocos valores extremos.
- **`.clip(area)`**: Recorta la composición resultante al AOI, ya que `.median()` opera sobre toda la extensión de las imágenes de entrada, no solo dentro del área de interés.
- Otras funciones de agregación disponibles para comparar (mencionadas en el script original): `.min()`, `.max()`, `.mean()`, cada una con un criterio distinto de qué valor "gana" por píxel entre todas las observaciones disponibles.

**Alternativa — mosaico de calidad basado en la imagen más reciente:**

```javascript
var mosaicoMasReciente = s2preProcesado.map(function(imagen) {
  return imagen.addBands(
    ee.Image(ee.Number(imagen.get('system:time_start')))
    .rename('tiempo')).toFloat();
  
}).qualityMosaic('tiempo');

Map.addLayer(mosaicoMasReciente, paramVisPreProcesada, 'Mosaico Más Reciente');
```

- **`imagen.get('system:time_start')`**: Metadato estándar de GEE con la fecha de captura de la imagen, en milisegundos desde 1970 (timestamp Unix).
- **`ee.Image(ee.Number(...)).rename('tiempo')`**: Convierte ese número (un valor puntual) en una imagen constante de una sola banda, con el mismo valor en todos los píxeles de esa escena, y la nombra `'tiempo'`.
- **`imagen.addBands(..., ).toFloat()`**: Agrega la banda `'tiempo'` a cada imagen de la colección, y convierte toda la imagen a tipo `float` para evitar conflictos de tipo de dato al comparar band a band entre imágenes distintas dentro de `qualityMosaic`.
- **`.qualityMosaic('tiempo')`**: Para cada píxel, recorre todas las imágenes de la colección y conserva los valores de la imagen cuya banda `'tiempo'` sea mayor en ese píxel — es decir, la observación válida (no enmascarada por nubes) más reciente disponible. A diferencia de la mediana, este método preserva valores reales de una sola fecha por píxel, útil cuando interesa el estado más actual del terreno en vez de un valor estadístico combinado.

## Paso 6: Exportar la composición a Google Drive y como GEE Asset

Se generan dos tareas de exportación para la misma composición: una a Google Drive (archivo GeoTIFF) y otra como Asset dentro del propio proyecto de Earth Engine.

```javascript
// Exportar a Google Drive
Export.image.toDrive({
  image: composicion.toFloat(),
  description: 'composicionMedianaSentinel2_1921',
  fileNamePrefix: 'composicionMedianaSentinel2_1921',
  region: area,
  scale: 10,
  maxPixels: 1e13
});

// Exportar como un GEE Asset
Export.image.toAsset({
  image: composicion,
  description: 'composicionMedianaSentinel2_1921',
  assetId: 'projects/ee-paulapaz1101/assets/biodiversity_workshop/GEODATA/composicionMedianaSentinel2', //! ACTUALIZAR A RUTA PROPIA
  region: area,
  scale: 10,
  maxPixels: 1e13
});
```

**Parámetros:**
- **Nota de transcripción:** en el script original, las líneas "Exportar para Google Drive." y "Exportar como un GEE Asset." aparecían como texto suelto dentro del bloque de código (sin `//`), lo cual no es JavaScript válido y haría fallar el script si se pegara tal cual en el editor. Acá se dejaron como comentarios (`//`) para que el bloque sea ejecutable.
- **`Export.image.toDrive({...})`**: Genera una tarea de exportación de una imagen a Google Drive, en formato GeoTIFF por defecto. Queda pendiente en la pestaña "Tasks" del editor y debe iniciarse manualmente (botón "Run").
- **`image: composicion.toFloat()`**: Convierte explícitamente la imagen a tipo `float` antes de exportar, para asegurar un tipo de dato homogéneo entre todas las bandas (las bandas espectrales reescaladas y las de índice pueden diferir sutilmente en tipo interno).
- **`fileNamePrefix`**: Nombre base del archivo de salida en Drive; en `Export.image.toDrive` es independiente de `description` (que solo nombra la tarea), aunque acá se usó el mismo valor para ambos.
- **`region: area`**: A diferencia de otros scripts del taller, que usan el rectángulo envolvente (`geom.bounds()`) del AOI por rendimiento, acá se pasa directamente la `FeatureCollection` `area` como región de exportación. Funciona porque las funciones `Export.*` aceptan cualquier objeto convertible a geometría, pero para un AOI grande (un país completo, como en este script) conviene evaluar si usar `area.geometry().bounds()` en su lugar, siguiendo el mismo criterio de rendimiento que otros scripts del taller.
- **`scale: 10`**: Resolución de exportación en metros, la resolución nativa de las bandas de 10 m de Sentinel-2 (`B2`, `B3`, `B4`, `B8`); las bandas de 20 m (como `B11`, `B12`) se remuestrean a esta escala en la exportación.
- **`maxPixels: 1e13`**: Límite máximo de píxeles que la tarea puede procesar antes de fallar; se fija alto porque el AOI es un país completo.
- **`Export.image.toAsset({...})`**: Misma lógica que `toDrive`, pero el destino es un Asset dentro de un proyecto de Earth Engine (`assetId`) en vez de un archivo en Drive, lo que permite reutilizar la composición como insumo de otros scripts sin volver a calcularla.
- **`assetId: 'projects/.../composicionMedianaSentinel2'`**: Ruta del Asset de destino; el comentario `//! ACTUALIZAR A RUTA PROPIA` en el script original marca que este valor debe reemplazarse por la ruta del proyecto de cada usuario antes de ejecutar la tarea.

**Ejecutar las exportaciones:** ir al panel `Tasks` y presionar `Run` sobre cada tarea de exportación generada.

**Código completo:** Script `03_Composición_Sentinel2` del repositorio, carpeta `day_1`, o enlace directo: [https://code.earthengine.google.com/ee01010da4b4ee92bb41c14674dc6c25?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop](https://code.earthengine.google.com/ee01010da4b4ee92bb41c14674dc6c25?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop)

<!-- ## Paso a paso

### Paso 1: Definir el área de interés
Importar la colección de límites administrativos a nivel país y filtrarla con `ee.Filter.eq()` para obtener el feature de Colombia.

```javascript
var limites = ee.FeatureCollection('FAO/GAUL/2015/level0');
var area = limites.filter(
  ee.Filter.eq('ADM0_NAME', 'Colombia')
);
```

### Centrar el mapa y visualizar el área

```javascript
Map.centerObject(area, 9);
Map.addLayer(area, {}, 'Área de Interés', false);
```

### Paso 2: Cargar y filtrar la colección Sentinel-2

Cargar `COPERNICUS/S2_SR_HARMONIZED` y filtrarla por ubicación (`.filterBounds()`), fecha (`.filterDate()`) y porcentaje de nubes (`ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20)`).

```javascript
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');

var s2filtrado = s2.filterBounds(area)
                   .filterDate('2025-01-01', '2026-01-01')
                   .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20));

print('Número de imágenes filtradas', s2filtrado.size());
```

> ** Nota técnica:** Vigencia de la banda `QA60` según el rango de fechas**
> - **Antes del 25 de enero de 2022:** `QA60` funciona normalmente.
> - **Entre el 25 de enero de 2022 y el 28 de febrero de 2024:** la banda `QA60` estuvo vacía (siempre en 0, "sin nubes"), incluso en escenas totalmente nubladas. Esto no genera un error de código, sino resultados incorrectos.
> - **Desde el 28 de febrero de 2024:** Google reconstruyó `QA60` de forma retroactiva a partir de otra banda (`MSK_CLASSI`), por lo que volvió a ser confiable para todo el historial de datos.
>
> **Recomendación:** para nuevos análisis, especialmente si trabaja con fechas recientes o no está seguro del rango temporal, considerar usar el dataset [`COPERNICUS/S2_CLOUD_PROBABILITY`](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_CLOUD_PROBABILITY) (basado en el algoritmo *s2cloudless*) en lugar de `QA60`, ya que es más robusto y no depende de estos cambios de procesamiento histórico de ESA.

### OPCIONAL: Verificar que las imágenes contengan la banda `QA60`
Antes de aplicar la función de enmascaramiento, filtrar la colección para conservar únicamente las imágenes que efectivamente contienen la banda `QA60`, usando `ee.Filter.listContains()`.

```javascript
s2filtrado = s2filtrado.filter(
  ee.Filter.listContains('system:band_names', 'QA60')
);
```

### Paso 3: Preprocesamiento de series temporales (Enmascaramiento de nubes y cálculo de índices)

### Crear la función de enmascaramiento de nubes (`QA60`)
La banda de calidad `QA60` proporciona información sobre la ocurrencia de nubes y otros aspectos de calidad de imagen.
La información se almacena en bits y usamos la función `bitWiseAnd` para extraerlo.


```javascript
function mascaraNubesS2(imagen) {
  var qa = imagen.select('QA60');

  var bitmaskNubes = 1 << 10;
  var bitmaskCirrus = 1 << 11;

  var mascara = qa.bitwiseAnd(bitmaskNubes).eq(0)
      .and(qa.bitwiseAnd(bitmaskCirrus).eq(0));
  
  var bandas = imagen.select('B.').divide(10000);
  
  return imagen.addBands(bandas, null, true).updateMask(mascara);
}
```

### Funcion para calcular índices
<!-- NDVI: (NIR-Red)/(NIR+Red)
LSWI: (NIR-SWIR1)/(NIR+SWIR1)
NDMI: (SWIR2-Red)/(SWIR2+Red) -->

| Índice | Fórmula |
|---|---|
| **NDVI** | (NIR − Red) / (NIR + Red) |
| **LSWI** | (NIR − SWIR1) / (NIR + SWIR1) |
| **NDMI** | (SWIR2 − Red) / (SWIR2 + Red) |

Utilizamos la función de GEE `normalizedDifference`

```javascript
function calcularIndices(imagen){
  var ndvi = imagen.normalizedDifference(['B8', 'B4']).rename('ndvi');
  var lswi = imagen.normalizedDifference(['B8', 'B11']).rename('lswi');
  var ndmi = imagen.normalizedDifference(['B12', 'B3']).rename('ndmi');
  var mndwi = imagen.normalizedDifference(['B3', 'B11']).rename('mndwi');
  
  return ee.Image.cat([imagen, ndvi, lswi, ndmi, mndwi]);
}
```

Aplicar funciones de pre procesamiento a las imágenes en la colección.
```javascript
var s2preProcesado = s2filtrado.map(mascaraNubesS2)
                               .map(calcularIndices);

print(s2preProcesado.first());
```

### Paso 4: Visualizar las primeras imágenes no procesadas y preprocesadas
```javascript
var primeraNoProcesada = s2filtrado.first();

var paramVisNoProcesada = {
  bands: ['B4', 'B3', 'B2'],
  min: -100,
  max: 1800
};

Map.addLayer(primeraNoProcesada, 
             paramVisNoProcesada, 
             'Primera Imagen No Procesada');

var primeraPreProcesada = s2preProcesado.first();

var paramVisPreProcesada = {
  bands: ['B4', 'B3', 'B2'],
  min: 0.0,
  max: 0.18
};

Map.addLayer(primeraPreProcesada, 
             paramVisPreProcesada, 
             'Primera Imagen Preprocesada');
```

### Paso5: Crear una composición
Utilizar las siguientes funciones para comparar diferentes agregaciones:`.min()`; `.max()`; `.mean()`; `.median()`

```javascript
var composicion = s2preProcesado.median().clip(area);
Map.addLayer(composicion, paramVisPreProcesada, 'Composición Preprocesada');
```

### Generar un mosaico de calidad basado en la imagen más reciente
```javascript
var mosaicoMasReciente = s2preProcesado.map(function(imagen) {
  return imagen.addBands(
    ee.Image(ee.Number(imagen.get('system:time_start')))
    .rename('tiempo')).toFloat();
  
}).qualityMosaic('tiempo');

Map.addLayer(mosaicoMasReciente, paramVisPreProcesada, 'Mosaico Más Reciente');
```

### Paso 6: Exportar la composición a Google Drive y GEE Asset

Exportar a Google Drive.
```javascript
Exportar para Google Drive.
Export.image.toDrive({
  image: composicion.toFloat(),
  description: 'composicionMedianaSentinel2_1921',
  fileNamePrefix: 'composicionMedianaSentinel2_1921',
  region: area,
  scale: 10,
  maxPixels: 1e13
});

Exportar como un GEE Asset.
Export.image.toAsset({
  image: composicion,
  description: 'composicionMedianaSentinel2_1921',
  assetId: 'projects/ee-paulapaz1101/assets/biodiversity_workshop/GEODATA/composicionMedianaSentinel2', //! ACTUALIZAR A RUTA PROPIA
  region: area,
  scale: 10,
  maxPixels: 1e13
});
```

> **Nota técnica:** Recuerda actualizar el `assetId` con la ruta de tu propio proyecto de Earth Engine antes de ejecutar la exportación.

**Ejecutar las exportaciones**

Ir al panel `Tasks` y presionar `Run` sobre cada tarea de exportación generada.

### Código completo
Script "`03_Composición_Sentinel2`" del repositorio y la carpeta `day_1` o link directo:
[https://code.earthengine.google.com/ee01010da4b4ee92bb41c14674dc6c25?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop](https://code.earthengine.google.com/ee01010da4b4ee92bb41c14674dc6c25?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop) -->