---
layout: page
title: 07_Conectividad
parent: "Introducción a GEE"
nav_order: 8
---

## 00_Corredores_Conectividad_geemap

# Objetivo
Calcular un **corredor de conectividad ecológica de costo mínimo** entre dos áreas protegidas (AP), combinando Google Earth Engine (paquete`geemap`) para construir una matriz de resistencia multicriterio, y Python ( paquete `scikit-image`) para el análisis de costo-distancia. Todo el workflow corre en un único notebook de Google Colab, sin pasos manuales de exportación/importación entre GEE y Python.

# Métodos
Matriz de resistencia multicriterio (geemap) + corredor de costo mínimo (Python)

1. Construcción de una matriz de resistencia multicriterio en Earth Engine (vía geemap/ee), combinando:
- Cobertura del suelo (ESA WorldCover)
- Pendiente (SRTM)
- Distancia a infraestructura / zonas urbanas (GHSL)
- Cercanía a cuerpos de agua (JRC Global Surface Water)
- Parches de hábitat existentes / stepping stones (cobertura arbórea conectada)
2. Descarga local de la resistencia y de las áreas protegidas (AP) fuente/destino.
3. Cálculo del corredor de costo mínimo (least-cost corridor, estilo Linkage Mapper) entre ambas AP con scikit-image.
4. Exportación de resultados (raster del corredor, costo-distancia combinado, ruta óptima) y visualización.
Todo el flujo corre en un solo notebook de Colab. No requiere pasar por Google Drive salvo que el área de análisis sea muy grande (se indica la alternativa en la celda de descarga).

# Paso a paso

## Instalación e importación de librerías

`geemap` no viene preinstalado en Colab por defecto, así que la primera celda lo instala junto con `rasterio` y `geopandas`.

```python
!pip install geemap rasterio geopandas -q
```

```python
import ee
import geemap
import numpy as np
import rasterio
import geopandas as gpd
from rasterio.features import rasterize
from skimage.graph import MCP_Geometric, route_through_array
from shapely.geometry import LineString
import matplotlib.pyplot as plt
import json
import os
```

## Autenticación e inicialización de Earth Engine

A diferencia de un script del Code Editor (que ya corre autenticado dentro del navegador), un notebook de Colab necesita autenticarse explícitamente contra la cuenta de Google y el proyecto de Google Cloud asociado a Earth Engine.

```python
GEE_PROJECT = 'TU_PROYECTO_GEE'

ee.Authenticate()
ee.Initialize(project=GEE_PROJECT)
```

`GEE_PROJECT` debe ser el ID real del proyecto de Google Cloud (visible en la consola de Earth Engine), no el nombre del script ni de un asset. Si `ee.Initialize()` falla con un error de permisos, normalmente significa que ese proyecto no tiene la API de Earth Engine habilitada.

## Parámetros del usuario

Todo lo que puede cambiar entre corridas (país, par de AP, pesos de los criterios, umbrales) está centralizado en una sola celda, siguiendo el mismo principio de parametrización por AOI usado en el resto del stack de indicadores GBF.

```python
country = 'Guatemala'
pa_name_source = 'Sierra del Lacandón'
pa_name_target = 'Laguna del Tigre'

buffer_meters = 20000
export_scale = 100

pesos = {
    'cobertura': 0.30,
    'pendiente': 0.15,
    'infra':     0.25,
    'agua':      0.15,
    'habitat':   0.15,
}
assert abs(sum(pesos.values()) - 1.0) < 1e-6, 'Los pesos deben sumar 1.0'
```

Los nombres de AP (`pa_name_source`, `pa_name_target`) deben coincidir exactamente con el campo `NAME` de WDPA. El notebook incluye una celda comentada para listar las AP disponibles en el país antes de fijarlos.

## AOI y áreas protegidas fuente/destino

```python
aoi_country = ee.FeatureCollection('FAO/GAUL/2015/level0') \
    .filter(ee.Filter.eq('ADM0_NAME', country))

wdpa = ee.FeatureCollection('WCMC/WDPA/current/polygons').filterBounds(aoi_country)

pa_source = ee.Feature(wdpa.filter(ee.Filter.eq('NAME', pa_name_source)).first())
pa_target = ee.Feature(wdpa.filter(ee.Filter.eq('NAME', pa_name_target)).first())

pa_source_geom = pa_source.geometry()
pa_target_geom = pa_target.geometry()

region_analisis = pa_source_geom.union(pa_target_geom, 1).buffer(buffer_meters).bounds()
```

La región de análisis es la caja delimitadora de ambas AP más un margen (`buffer_meters`), no el país completo — esto mantiene manejable el tamaño de la descarga posterior.

## Construcción de la matriz de resistencia multicriterio

Cada criterio se normaliza en una escala 0 (resistencia mínima) a 100 (resistencia máxima) y luego se combinan por suma ponderada. A modo de ejemplo, así se construyen dos de los cinco criterios:

**Cobertura del suelo (ESA WorldCover):**

```python
worldcover = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map')

clases       = [10, 20, 30, 40, 50, 60,  70,  80, 90, 95, 100]
resistencias = [1,  10,  20,  50, 100, 70, 100,  80,  5,  1,  20]

res_cobertura = worldcover.remap(clases, resistencias, 50).rename('res_cobertura').toFloat()
```

**Distancia a infraestructura / zonas urbanas (GHSL):**

```python
ghsl_built = ee.Image('JRC/GHSL/P2023A/GHS_BUILT_S/2020').select('built_surface')

mascara_urbana = ghsl_built.gt(built_area_threshold_m2)

dist_urbano = mascara_urbana.fastDistanceTransform(256).sqrt() \
    .multiply(ee.Image.pixelArea().sqrt()).rename('dist_urbano')

res_infra = ee.Image(100).subtract(
    dist_urbano.divide(infra_threshold_m).multiply(100)
).clamp(0, 100).rename('res_infra')
```

`JRC/GHSL/P2023A/GHS_BUILT_S/2020` es una `Image` puntual para el año 2020, no una `ImageCollection` — se carga directamente con `ee.Image(...)`, sin `.mosaic()` ni filtrado por fecha.

Los otros tres criterios (pendiente vía SRTM, cercanía a agua vía JRC Global Surface Water, y parches de hábitat vía cobertura arbórea conectada) siguen la misma lógica de normalización 0–100. La combinación final es:

```python
resistencia_norm = res_cobertura.multiply(pesos['cobertura']) \
    .add(res_pendiente.multiply(pesos['pendiente'])) \
    .add(res_infra.multiply(pesos['infra'])) \
    .add(res_agua.multiply(pesos['agua'])) \
    .add(res_habitat.multiply(pesos['habitat'])) \
    .rename('resistencia_norm')

resistencia_final = resistencia_norm.divide(100) \
    .multiply(resistencia_max - resistencia_min).add(resistencia_min)

mascara_ap = ee.Image(0).paint(ee.FeatureCollection([pa_source, pa_target]), 1)
resistencia_final = resistencia_final.where(mascara_ap.eq(1), resistencia_min) \
    .rename('resistencia').clip(region_analisis).toFloat()
```

Dentro de las propias AP se fuerza resistencia mínima: son el origen/destino del desplazamiento, no un obstáculo.

## Visualización en geemap

```python
Map = geemap.Map()
Map.centerObject(region_analisis, 9)
Map.addLayer(resistencia_final, {'min': resistencia_min, 'max': resistencia_max,
                                  'palette': ['1a9850', 'fee08b', 'd73027']}, 'Resistencia final')
Map.addLayer(pa_source_geom, {'color': '2166ac'}, f'AP fuente: {pa_name_source}')
Map.addLayer(pa_target_geom, {'color': '762a83'}, f'AP destino: {pa_name_target}')
Map
```

## Descarga local de la resistencia

```python
ruta_resistencia = f'{carpeta_salida}/resistencia_corredor.tif'

geemap.download_ee_image(
    resistencia_final,
    filename=ruta_resistencia,
    region=region_analisis,
    scale=export_scale,
    crs='EPSG:4326',
    num_threads=4
)
```

`geemap.download_ee_image()` parte automáticamente la descarga en tiles cuando la imagen supera el límite de 50 MB por solicitud de Earth Engine, y las reensambla en un solo GeoTIFF — no hace falta manejar el tileo manualmente. Si aparecen warnings de `"Connection pool is full"` durante la descarga, no son errores; basta con bajar `num_threads` (por ejemplo, de 8 a 4) para reducir la cantidad de conexiones simultáneas.

## Corredor de costo mínimo (scikit-image)

Con la resistencia ya en disco, el resto del análisis es puro Python. Se calcula el costo-distancia acumulado desde cada AP, se suman ambas superficies, y se aplica un umbral por percentil para definir el ancho del corredor:

```python
mcp_fuente = MCP_Geometric(resistencia, fully_connected=True)
cwd_fuente, _ = mcp_fuente.find_costs([punto_fuente])

mcp_destino = MCP_Geometric(resistencia, fully_connected=True)
cwd_destino, _ = mcp_destino.find_costs([punto_destino])

cwd_total = cwd_fuente + cwd_destino

umbral = np.percentile(cwd_total[np.isfinite(cwd_total)], percentil_corredor)
corredor_binario = (cwd_total <= umbral).astype('uint8')
```

`percentil_corredor` (5% por defecto) es el parámetro más sensible del análisis: define qué porcentaje de píxeles con menor costo acumulado combinado se conservan como corredor. Conviene comparar 5%, 10% y 15% antes de fijar un resultado para un informe.

Adicionalmente se extrae la ruta óptima única (línea central) con `route_through_array`, útil como referencia pero no como predicción literal de la trayectoria de un individuo.

## Visualización final del corredor

```python
from rasterio.features import shapes as rio_shapes
from shapely.geometry import shape
from shapely.ops import unary_union

with rasterio.open(f'{carpeta_salida}/corredor_binario.tif') as src:
    corredor_arr = src.read(1)
    corredor_transform = src.transform
    corredor_crs = src.crs

poligonos_corredor = [
    shape(geom) for geom, valor in rio_shapes(corredor_arr, transform=corredor_transform)
    if valor == 1
]
corredor_union = unary_union(poligonos_corredor)

corredor_ee = geemap.geopandas_to_ee(
    gpd.GeoDataFrame({'geometry': [corredor_union]}, crs=corredor_crs)
)

Map.addLayer(corredor_ee, {'color': 'ff00ff'}, 'Corredor de costo mínimo')
Map
```

El corredor se vectoriza (`rasterio.features.shapes`) y se agrega al mapa como una capa de Earth Engine en lugar de como raster local: `geemap` renderiza rasters locales mediante `localtileserver`, una librería que no funciona dentro de Colab. Vectorizar y usar `Map.addLayer` evita esa limitación y de paso deja el corredor como una geometría reutilizable (por ejemplo, para calcular su área en hectáreas).

**Código completo:** [https://colab.research.google.com/drive/14rxxDr-bTf7AhS1nl65rnkolJwH37k9M?usp=sharing](https://colab.research.google.com/drive/14rxxDr-bTf7AhS1nl65rnkolJwH37k9M?usp=sharing)

# Actividad
1. Seleccionar dos áreas protegidas de interés - usar visualizador de Áreas Protegidas de WDPA para encontrar nombre de AOI [https://code.earthengine.google.com/20ec4dfc9372c575dec3351fd54822aa?hl=es-419](https://code.earthengine.google.com/20ec4dfc9372c575dec3351fd54822aa?hl=es-419).
2. Definir nombre de país donde se encuentran AP.
3. Correr de nuevo código COLAB.
4. Compartir resultados!


