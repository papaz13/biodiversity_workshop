---
layout: page
title: 01_Visualización_imágen
parent: "Introducción a GEE"
nav_order: 2
---

# 01_Visualización_imágen

## Objectives
1. Add layers and start building an example map.
2. Navigate the Map Canvas.
3. Understand symbology.

### Cargar conjunto de datos del Earth Catalog
En este ejercicio vamos a `importar` el modelo de elevación de 30 m de NASA SRTM. El [Data Catalog](https://developers.google.com/earth-engine/datasets) de Earth Engine es un repositorio público con cientos de conjuntos de datos geoespaciales listos para usar (imágenes satelitales, modelos de elevación, cobertura terrestre, clima, entre otros). Cada dataset tiene una página propia con su descripción, resolución, fechas disponibles, bandas, y — lo más importante — su **ID único**, que es lo que necesitamos para cargarlo en nuestro código.

Para encontrar el dataset SRTM, puede buscar "SRTM" directamente en la barra de búsqueda de la parte superior del Code Editor. Al hacer clic en el resultado, se abre una ventana con la documentación del dataset, incluyendo un botón `Import` que agrega automáticamente la imagen a su script como una variable.

<p align="center">
  <img src="images/intro-gee/fig8.png" width="600" style="margin: 10px 0;">
</p>

También podemos importar el dataset directamente escribiendo el código, en lugar de usar el botón `Import`. Esto nos da más control sobre el nombre de la variable y hace que el script sea más fácil de leer y compartir. Para esto, copiamos el ID del dataset que aparece en la página del catálogo (`USGS/SRTMGL1_003`) y lo usamos dentro de la función `ee.Image()`:

```javascript
var elevacion = ee.Image("USGS/SRTMGL1_003");
```
Una vez que tenemos el raster cargado, usamos la función `Map.addLayer()` para visualizar en el mapa. Toma como parámetros la imagen a mostrar, los parámetros de visualización (opcional) y un nombre de capa (string) que aparecerá en la lista de capas del mapa.

```javascript
Map.addLayer(elevacion,"","Elevacion");
```







