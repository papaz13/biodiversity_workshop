---
layout: page
title: 01_Visualización_imágen
parent: "Introducción a GEE"
nav_order: 2
---

# 01_Visualización_imágen
## Objetivos
1. Importar imágen desde el catalogo de datos
2. Visualizar en el mapa
3. Clasificar valores continuos

## Datos
- SRTM , collection: `ee.Image("USGS/SRTMGL1_003")`

## Método
- Emplear función `.where()`
- Uso de operadores de comparación `.gt()` (greater than, "mayor que").

## Paso a paso
## Paso 1: Cargar el conjunto de datos desde el Data Catalog

En este ejercicio se importa el modelo de elevación de 30 m de NASA SRTM desde el [Data Catalog](https://developers.google.com/earth-engine/datasets) de Earth Engine. Cada dataset tiene una página propia con su descripción, resolución, fechas disponibles, bandas, y su **ID único**, que es lo que se necesita para cargarlo en el código.

Para encontrar el dataset SRTM, se puede buscar "SRTM" directamente en la barra de búsqueda de la parte superior del Code Editor. Al hacer clic en el resultado, se abre una ventana con la documentación del dataset, incluyendo un botón `Import` que agrega automáticamente la imagen al script como una variable.

<p align="center">
  <img src="{{ '/images/intro-gee/fig8.png' | relative_url }}" width="400" style="margin: 10px 0;">
</p>

También se puede importar el dataset directamente escribiendo el código, en lugar de usar el botón `Import`. Esto da más control sobre el nombre de la variable y hace que el script sea más fácil de leer y compartir. Para esto, se copia el ID del dataset que aparece en la página del catálogo (`USGS/SRTMGL1_003`) y se usa dentro de la función `ee.Image()`:

```javascript
var elevacion = ee.Image("USGS/SRTMGL1_003");
```

**Parámetros:**
- **`ee.Image("USGS/SRTMGL1_003")`**: Carga una única imagen (no una `ImageCollection`, ya que SRTM es un mosaico estático global sin serie temporal) identificada por su ID de asset. La banda resultante contiene la elevación en metros sobre el nivel del mar.

## Paso 2: Visualizar en el mapa

Utilizar la función `Map.addLayer()` para visualizar el objeto `Image` en el mapa. La función tiene tres parámetros: la imagen a visualizar, un objeto de parámetros de visualización (opcional, aquí se deja vacío `""`), y un nombre de capa (string) que identificará la capa en el panel `Layers`.

```javascript
Map.addLayer(elevacion,"","Elevacion");
```

**Parámetros:**
- **`elevacion`**: La imagen a mostrar, cargada en el Paso 1.
- **`""` (segundo argumento, parámetros de visualización)**: Al dejarse vacío, GEE aplica un estilo de visualización por defecto (escala de grises, estirada automáticamente al rango de valores de la imagen), en vez de una paleta de colores definida manualmente.
- **`"Elevacion"`**: Nombre de la capa, tal como aparece en el panel `Layers` del visor.

## Paso 3: Clasificar valores con `.where()`

Crear una imagen base de valor constante 0 usando `ee.Image(0)`. Sobre esta imagen, aplicar la función `.where(condición, valor)` de forma encadenada para reasignar valores a los píxeles que cumplan cada condición de altitud, definida con el operador `.gt()` (mayor que). (Existen otros operadores de comparación como `.lt()` — menor que — o `.eq()` — igual a). Esto reclasifica los píxeles en distintas zonas de elevación: todos los píxeles con elevación mayor a 50 m toman el valor 50, los mayores a 150 m toman el valor 150, y así sucesivamente. El orden de las condiciones importa, ya que cada `.where()` se aplica sobre el resultado del anterior, sobrescribiendo los valores donde la condición se cumple.

Finalmente, se emplea la función `.updateMask(elevacion.gt(0))` para enmascarar (ocultar) los píxeles donde la elevación original es menor o igual a 0, típicamente correspondientes a cuerpos de agua o áreas sin datos válidos.

```javascript
var zonas = ee.Image(0)
    .where(elevacion.gt(50), 50)
    .where(elevacion.gt(150), 150)
    .where(elevacion.gt(200), 200)
    .updateMask(elevacion.gt(0));
```

**Parámetros:**
- **`ee.Image(0)`**: Imagen constante de valor 0 en todos los píxeles del planeta; sirve como lienzo base sobre el que se van sobrescribiendo las zonas de elevación.
- **`.where(elevacion.gt(50), 50)`**: `elevacion.gt(50)` genera una imagen booleana (1 donde la elevación supera 50 m, 0 en caso contrario); `.where(condición, valor)` reemplaza por `50` los píxeles de la imagen base donde esa condición es verdadera, dejando el resto sin cambios.
- **Encadenamiento de `.where()`**: cada llamada siguiente opera sobre el resultado de la anterior, no sobre la imagen original `ee.Image(0)`. Por eso el orden ascendente (50, luego 150, luego 200) es importante: un píxel con elevación de 250 m primero se marca como 50, luego se sobrescribe a 150, y finalmente se sobrescribe a 200, quedando con el valor correcto de la última condición que cumple.
- **`.updateMask(elevacion.gt(0))`**: Aplica como máscara la condición de elevación estrictamente positiva; los píxeles con elevación ≤ 0 (mar, cuerpos de agua, o vacíos de datos del propio SRTM) quedan sin dato en `zonas`, en vez de mostrarse incorrectamente con el valor 0 del lienzo base.

Finalmente, utilizar la función `Map.addLayer()` para visualizar en el mapa el nuevo ráster de elevación clasificado. Los parámetros de visualización corresponden a: nombre de la variable ráster clasificado, parámetros de visualización, nombre de la capa.

```javascript
Map.addLayer(zonas, 
              {min: 0, max: 200, palette: ["blue", "green", "yellow", "red"]},
              "Elevación clasificada");
```

**Parámetros:**
- **`zonas`**: La imagen reclasificada del bloque anterior.
- **`{min: 0, max: 200, palette: [...]}`**: Define el rango de valores que se mapea a la paleta de colores. Como `zonas` ya solo puede tomar los valores 0, 50, 150 o 200 (por la reclasificación), `min`/`max` fijan los extremos del degradado, y cada uno de esos cuatro valores discretos toma el color correspondiente a su posición proporcional dentro del rango.
- **`palette: ["blue", "green", "yellow", "red"]`**: Rampa de color de cuatro tonos, de menor a mayor elevación: azul (zonas bajas / valor 0) pasando por verde y amarillo hasta rojo (zonas más altas / valor 200).
- **`"Elevación clasificada"`**: Nombre de la nueva capa en el panel `Layers`, distinto del nombre `"Elevacion"` usado en el Paso 2 para la capa sin clasificar, de forma que ambas queden disponibles simultáneamente para comparar.

**Código completo:** Script `01_Visualización_imágen` del repositorio, carpeta `day_1`, o enlace directo: [https://code.earthengine.google.com/fb060a9e239501ce553cbf9257b073fd?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop](https://code.earthengine.google.com/fb060a9e239501ce553cbf9257b073fd?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop)

<!-- ## Paso a paso

### Paso 1: Cargar conjunto de datos del Earth Catalog
En este ejercicio vamos a `importar` el modelo de elevación de 30 m de NASA SRTM desde el [Data Catalog](https://developers.google.com/earth-engine/datasets) de Earth Engine Cada dataset tiene una página propia con su descripción, resolución, fechas disponibles, bandas, y su **ID único**, que es lo que necesitamos para cargarlo en nuestro código.

Para encontrar el dataset SRTM, puede buscar "SRTM" directamente en la barra de búsqueda de la parte superior del Code Editor. Al hacer clic en el resultado, se abre una ventana con la documentación del dataset, incluyendo un botón `Import` que agrega automáticamente la imagen a su script como una variable.
<p align="center">
  <img src="{{ '/images/intro-gee/fig8.png' | relative_url }}" width="400" style="margin: 10px 0;">
</p>

También podemos importar el dataset directamente escribiendo el código, en lugar de usar el botón `Import`. Esto nos da más control sobre el nombre de la variable y hace que el script sea más fácil de leer y compartir. Para esto, copiamos el ID del dataset que aparece en la página del catálogo (`USGS/SRTMGL1_003`) y lo usamos dentro de la función `ee.Image()`:

```javascript
var elevacion = ee.Image("USGS/SRTMGL1_003");
```

### Paso 2: Visualizar en el mapa
Utilizar la función `Map.addLayer()` para visualizar el objeto `Image` en el mapa. La función tiene tres parámetros la imagen a visualizar, un objeto de parámetros de visualización (opcional, aquí se deja vacío `""`), y un nombre de capa (string) que identificará la capa en el panel `Layers`.

```javascript
Map.addLayer(elevacion,"","Elevacion");
```

### Paso 3: Clasificar valores con `.where()`
Crear una imagen base de valor constante 0 usando `ee.Image(0)`. Sobre esta imagen, aplicar la función `.where(condición, valor)` de forma encadenada para reasignar valores a los píxeles que cumplan cada condición de altitud, definida con el operador `.gt()` (greater than, "mayor que"). (Existen otros operadores de comparación como `.lt()` (menor que), o `.eq()` (igual a)). Esto reclasificará los pixeles en distintas zonas de elevación: todos los píxeles con elevación mayor a 50 m toman el valor 50, los mayores a 150 m toman el valor 150, y así sucesivamente. El orden de las condiciones importa, ya que cada `.where()` se aplica sobre el resultado del anterior, sobrescribiendo los valores donde la condición se cumple.

Finalmente emplea la función `.updateMask(elevacion.gt(0))`para enmascarar (oculta) los píxeles donde la elevación original es menor o igual a 0, típicamente correspondientes a cuerpos de agua o áreas sin datos válidos.

```javascript
var zonas = ee.Image(0)
    .where(elevacion.gt(50), 50)
    .where(elevacion.gt(150), 150)
    .where(elevacion.gt(200), 200)
    .updateMask(elevacion.gt(0));
```

Finalmente utilizar la función `Map.addLayer()` para visualizar en el mapa el nuevo raster de elevación clasificado. Los parámetros de visualización corresponden, nombre de variable raster clasificado, parámetros de visualización, nombre de la capa.
```javascript
Map.addLayer(zonas, 
              {min: 0, max: 200, palette: ["blue", "green", "yellow", "red"]},
              "Elevación clasificada");
```

### Código completo
Script "`01_Visualización_imágen`" del repositorio y la carpeta `day_1` o link directo:
[https://code.earthengine.google.com/fb060a9e239501ce553cbf9257b073fd?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop](https://code.earthengine.google.com/fb060a9e239501ce553cbf9257b073fd?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop) -->




