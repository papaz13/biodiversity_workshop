---
layout: page
title: 06_Stock_Perdida_Carbono
parent: "Introducción a GEE"
nav_order: 7
---

## 06_Stock_Perdida_Carbono

# Objetivos

Calcular, para un área de interés (AOI), el stock de carbono forestal y estimar cuánto de ese carbono se perdió por deforestación en un período reciente. El script combina dos fuentes de carbono con distinto alcance (aéreo vs. aéreo+subterráneo) y un dataset independiente de cambio de cobertura forestal para detectar pérdida:

1. Stock de carbono aéreo + subterráneo (un solo período de referencia, año 2010).
2. Stock de carbono aéreo (con desagregación posible entre aéreo y subterráneo en la fuente).
3. Carbono aéreo ubicado en píxeles donde hubo pérdida de bosque entre 2022 y 2024.

**Nota importante de terminología:** "biomasa" y "carbono" no son lo mismo. La biomasa es el peso seco de la vegetación; el carbono es, aproximadamente, el 47-50% de esa biomasa (factor de conversión estándar del IPCC). Ambos datasets usados en este script entregan directamente carbono (Mg C/ha), no biomasa cruda, aunque uno de ellos incluye la palabra "biomass" en su nombre.

## Datos

- **`WCMC/biomass_carbon_density/v1_0`** — Carbono aéreo + subterráneo (WCMC). Dataset de UNEP-WCMC (Soto-Navarro et al., 2020) que reporta, para el año 2010, el carbono combinado de biomasa aérea y subterránea (ambos compartimentos sumados y convertidos a carbono con un factor 0.5) en una sola banda, `carbon_tonnes_per_ha` (Mg C/ha). No tiene serie temporal: es una única imagen de referencia para circa 2010.<br>
Collection: `ee.ImageCollection("WCMC/biomass_carbon_density/v1_0")`
- **`NASA/ORNL/biomass_carbon_density/v1`** — Carbono aéreo y subterráneo por separado (ORNL). Dataset de NASA/ORNL (Spawn et al., 2020), también de referencia para 2010, pero con el carbono aéreo y subterráneo reportados en bandas separadas: `agb` (aéreo) y `bgb` (subterráneo), ambas en Mg C/ha. Este script usa únicamente la banda `agb`.<br>
Collection: `ee.ImageCollection("NASA/ORNL/biomass_carbon_density/v1")`
- **`UMD/hansen/global_forest_change_2024_v1_12`** — Cambio de cobertura forestal (Hansen GFC). Serie de Hansen et al. (2013), actualizada anualmente. La banda `lossyear` indica, píxel por píxel, el año en que ocurrió pérdida de cobertura forestal, codificado como número entero: 0 = sin pérdida, 1 = año 2001, 2 = año 2002, …, 24 = año 2024.<br>
Image: `ee.Image("UMD/hansen/global_forest_change_2024_v1_12")`
- **`WCMC/WDPA/current/polygons`** y **`FAO/GAUL_SIMPLIFIED_500m/2015/level0`** — Definición del AOI. Se usan para delimitar el área de interés: la WDPA para un área protegida puntual (por ejemplo, un parque nacional), o el límite administrativo nacional simplificado de la FAO para un país completo.<br>
Collection: `ee.FeatureCollection("WCMC/WDPA/current/polygons")` / `ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level0")`

## Métodos

1. Máscara ráster del AOI (álgebra de bandas)
2. Cálculo de stock total por reducción de región (`reduceRegion`, `sum`)
3. Funciones reutilizables en GEE
4. Filtrado por año de pérdida (Hansen `lossyear`)
5. Exportación de imágenes a Google Drive

## Paso a paso
## Paso 1: Definir el área de interés y cargar las capas de carbono

Se define el AOI, se prepara una máscara ráster para recortar las imágenes por álgebra de bandas, y se cargan las dos capas de carbono ya recortadas a esa máscara.

```javascript
var area = WDPA.filter(ee.Filter.eq('NAME', 'Chingaza'));
var ESCALA = 30;

// var area = GAUL0.filter(ee.Filter.eq('ADM0_NAME', 'Colombia'));
// var ESCALA = 300;

var geom = area.geometry();
var geomBounds = geom.bounds(1000);
Map.centerObject(area, 7);

var MAXPIX = 1e13;
var TILESCALE = 16;

var maskAOI = ee.Image.constant(1).clip(geom).mask().rename('aoi');

var carbonoWCMC = ABGB
	.first()
    .select('carbon_tonnes_per_ha')
	.updateMask(maskAOI);

var carbonoORNL = GABGB
	.first()
	.select('agb')
    .updateMask(maskAOI);
```

**Parámetros:**
- **`WDPA.filter(ee.Filter.eq('NAME', 'Chingaza'))`**: Selecciona, dentro de la Base de Datos Mundial de Áreas Protegidas, el polígono cuyo atributo `NAME` coincide exactamente con `'Chingaza'`. Es la opción de AOI puntual (un parque).
- **`GAUL0.filter(ee.Filter.eq('ADM0_NAME', 'Colombia'))` (comentado)**: Alternativa de AOI a escala país: selecciona el polígono nacional cuyo atributo `ADM0_NAME` es `'Colombia'`, del dataset de límites administrativos ya simplificados.
- **`ESCALA`**: Resolución en metros usada en todas las reducciones del script. 30 m es apropiado para un AOI pequeño (un parque); 300 m es más adecuado para un país completo, donde una resolución más fina implicaría procesar una cantidad de píxeles excesiva.
- **`geom.bounds(1000)`**: Calcula el rectángulo envolvente (bounding box) del AOI. El argumento (`1000`) es el `maxError` en metros: la tolerancia de simplificación permitida en ese cálculo. Este rectángulo, y no la geometría real del AOI, es lo que se usará como parámetro `geometry` en las `reduceRegion` posteriores, porque GEE resuelve casi instantáneamente la intersección de una tesela contra un rectángulo, mientras que contra un polígono de muchos vértices ese mismo paso puede tardar minutos por tesela.
- **`Map.centerObject(area, 7)`**: Centra el visor de mapa sobre el AOI. El segundo argumento (7) es el nivel de zoom inicial.
- **`MAXPIX = 1e13`**: Límite máximo de píxeles que una `reduceRegion` puede procesar antes de fallar. Se fija alto para evitar el error "Too many pixels in the region" en AOI grandes.
- **`TILESCALE = 16`**: Valor máximo permitido por la API. Cuando se usa como parámetro `tileScale` en `reduceRegion`, reparte el cálculo en teselas más pequeñas, evitando errores de memoria en regiones o imágenes grandes.
- **`ee.Image.constant(1).clip(geom).mask()`**: Construye una máscara ráster binaria del AOI: una imagen de valor 1 en todo el planeta, recortada a la forma exacta del AOI, de la cual se extrae solo la máscara (1 dentro, sin dato fuera). Se usa luego con `updateMask()` para recortar cualquier otra imagen sin pasarle la geometría vectorial completa.
- **`ABGB.first()`**: `ABGB` es la `ImageCollection` de WCMC (`WCMC/biomass_carbon_density/v1_0`), que contiene una sola imagen (año 2010); `.first()` la extrae.
- **`.select('carbon_tonnes_per_ha')`**: Selecciona la única banda de esa imagen: el carbono combinado aéreo + subterráneo, en Mg C/ha.
- **`GABGB.first().select('agb')`**: `GABGB` es la `ImageCollection` de NASA/ORNL; `.first()` extrae su imagen de referencia (2010), y `.select('agb')` se queda con la banda de carbono aéreo (Mg C/ha), descartando la banda `'bgb'` (carbono subterráneo) que también existe en esa fuente.
- **`.updateMask(maskAOI)`**: Aplica la máscara del AOI a cada capa de carbono: los píxeles fuera del AOI quedan sin dato, sin necesidad de recortar por geometría vectorial.

## Paso 2: Función para calcular el stock total de carbono en toneladas

Se define una función reutilizable que convierte una capa de densidad de carbono (Mg C/ha) en un stock total (Mg C) dentro del AOI.

```javascript
function stockTotalMg(imgMgHa) {
	var perPix = imgMgHa.multiply(ee.Image.pixelArea()).divide(10000);
	return ee.Number(
    	perPix.reduceRegion({
        	reducer: ee.Reducer.sum(),
        	geometry: geomBounds,
        	scale: ESCALA,
        	bestEffort: true,
        	tileScale: TILESCALE,
        	maxPixels: MAXPIX
    	}).values().get(0)
    );
}
```

**Parámetros:**
- **`imgMgHa.multiply(ee.Image.pixelArea())`**: `ee.Image.pixelArea()` genera una imagen donde cada píxel contiene su propia área real en m² (varía levemente con la latitud). Al multiplicar la densidad de carbono (Mg C/ha) por esa área, y luego dividir entre 10 000 (m² por hectárea), cada píxel queda expresado en toneladas de carbono absolutas (no por hectárea).
- **`reducer: ee.Reducer.sum()`**: Suma los valores (ya convertidos a toneladas por píxel) de todos los píxeles válidos dentro de la región.
- **`geometry: geomBounds`**: Región sobre la que se calcula la suma: el rectángulo envolvente del AOI (ver Paso 1), no la geometría real. Los píxeles fuera del AOI ya están enmascarados (por `updateMask(maskAOI)` aplicado antes de llamar a esta función), así que no se contabilizan aunque el rectángulo los incluya.
- **`scale: ESCALA`**: Resolución en metros con la que se muestrea la imagen para la suma.
- **`bestEffort: true`**: Si la región es demasiado grande para la escala solicitada, GEE ajusta automáticamente la escala hacia arriba (píxeles más grandes) en vez de arrojar un error.
- **`tileScale: TILESCALE`**: Reparte el cálculo en teselas más pequeñas (hasta 16), reduciendo el riesgo de errores de memoria.
- **`maxPixels: MAXPIX`**: Límite máximo de píxeles que la operación puede procesar antes de fallar.
- **`.values().get(0)`**: `reduceRegion()` devuelve un diccionario con una entrada por banda de la imagen (acá solo hay una banda). `.values()` lo convierte en una lista de valores, y `.get(0)` toma el primero (y único).
- **`ee.Number(...)`**: Convierte el resultado a un tipo `Number` explícito del lado del servidor, necesario para poder seguir operando con él (sumas, divisiones) en otros pasos del script.

## Paso 3: Reportar el stock de carbono

Se imprimen en la consola tres valores: el carbono medio por hectárea (WCMC) y el stock total en toneladas, tanto para el carbono combinado (WCMC) como para el carbono aéreo (ORNL).

```javascript
print('Carbono medio, aéreo + subterráneo (Mg C/ha) — WCMC:',
	carbonoWCMC.reduceRegion({
    	reducer: ee.Reducer.mean(),
    	geometry: geomBounds,
    	scale: ESCALA,
    	bestEffort: true,
    	tileScale: TILESCALE,
    	maxPixels: MAXPIX
	}));

print('Stock total de carbono, aéreo + subterráneo (Mg C) — WCMC:',
	stockTotalMg(carbonoWCMC));

print('Stock total de carbono aéreo (Mg C) — ORNL:',
	stockTotalMg(carbonoORNL));
```

**Parámetros:**
- **`carbonoWCMC.reduceRegion({ reducer: ee.Reducer.mean(), ... })`**: Calcula el promedio de Mg C/ha dentro del AOI. `reducer: ee.Reducer.mean()` define la estadística (promedio, no suma); los parámetros `geometry`, `scale`, `bestEffort`, `tileScale` y `maxPixels` cumplen el mismo rol descrito en el Paso 2.
- **El resultado de este `print`**: Es un diccionario con una clave por banda de la imagen (acá, `'carbon_tonnes_per_ha'`) y su valor promedio dentro del AOI — no un número suelto.
- **`stockTotalMg(carbonoWCMC)`**: Reutiliza la función del Paso 2 para obtener el stock total (toneladas absolutas, no por hectárea) de carbono combinado aéreo + subterráneo.
- **`stockTotalMg(carbonoORNL)`**: Misma función, aplicada ahora a la capa de carbono aéreo de ORNL. Comparar este valor contra el de WCMC permite estimar, de forma aproximada, cuánto del carbono total corresponde a la parte aérea frente a la subterránea (aunque provienen de fuentes distintas y no son estrictamente comparables pixel a pixel).

## Paso 4: Estimar el carbono perdido por deforestación reciente

Se identifican los píxeles donde Hansen GFC reporta pérdida de bosque entre 2022 y 2024, y se calcula cuánto carbono aéreo (ORNL) había en esos píxeles.

```javascript
var gfc = ee.Image('UMD/hansen/global_forest_change_2024_v1_12');

var perdida = gfc.select('lossyear').gte(22).and(gfc.select('lossyear').lte(24));

var carbonoPerdido = carbonoORNL.updateMask(perdida);

print('Carbono perdido por deforestación 2022-2024 (Mg C) — ORNL:',
    stockTotalMg(carbonoPerdido.unmask(0)));
```

**Parámetros:**
- **`ee.Image('UMD/hansen/global_forest_change_2024_v1_12')`**: Carga la imagen global de cambio de cobertura forestal (Hansen et al., 2013, actualizada a 2024). No se recorta con `.clip(geom)` porque las operaciones siguientes (`select`, comparaciones) no dependen de reducir la extensión; el recorte efectivo ocurre más adelante, al combinarla con `carbonoORNL` (que ya está enmascarada al AOI).
- **`gfc.select('lossyear')`**: Extrae la banda que indica, por píxel, el año de pérdida de bosque (0 = sin pérdida; 1 a 24 = años 2001 a 2024).
- **`.gte(22).and(...lte(24))`**: `gte(22)` genera una imagen booleana (1/0) donde el año de pérdida es mayor o igual a 22 (año 2022 en adelante). `.and()` la combina con otra imagen booleana de `.lte(24)` (año de pérdida menor o igual a 24, es decir, 2024 o antes). El resultado (`perdida`) es 1 solo en los píxeles cuyo año de pérdida cae exactamente en el rango 2022-2024.
- **`carbonoORNL.updateMask(perdida)`**: Aplica la máscara de pérdida reciente sobre la capa de carbono aéreo: solo quedan visibles (con dato) los píxeles que tenían carbono Y que perdieron bosque en 2022-2024.
- **`carbonoPerdido.unmask(0)`**: Antes de sumar, se reemplazan los píxeles sin dato (fuera de la zona de pérdida) por 0 explícito. En una suma (`Reducer.sum()`) esto es equivalente a dejarlos enmascarados —los píxeles sin dato no se contabilizan de todas formas—, pero `unmask(0)` deja la imagen en un estado más predecible si se reutiliza en otro cálculo más adelante.
- **`stockTotalMg(carbonoPerdido.unmask(0))`**: Reutiliza la función del Paso 2 para obtener, en toneladas absolutas, cuánto carbono aéreo estaba almacenado en las zonas que se deforestaron entre 2022 y 2024 dentro del AOI. Es una aproximación del carbono liberado (o en riesgo de liberarse) por esa deforestación, no una medición directa de emisiones.

## Paso 5: Visualizar las capas en el mapa

Se agregan al visor la capa de carbono aéreo, la capa de carbono perdido por deforestación, y el contorno del AOI.

```javascript
Map.addLayer(carbonoORNL,
	{ min: 0, max: 150, palette: ['#ffffcc', '#41ab5d', '#005a32'] },
	'Carbono aéreo (Mg C/ha) — ORNL');

Map.addLayer(carbonoPerdido,
	{ min: 0, max: 150, palette: ['#fee5d9', '#de2d26'] },
    'Carbono aéreo perdido 2022-2024');

Map.addLayer(area, { color: 'red' }, 'Área de interés', false);
```

**Parámetros:**
- **`Map.addLayer(eeObject, visParams, name, shown)`**: Firma general: `eeObject` es la capa a mostrar; `visParams` define su estilo visual; `name` es el texto que aparece en el panel "Layers" del visor; `shown` (booleano, por defecto `true`) controla si la capa arranca visible.
- **`min: 0, max: 150`**: Define el rango de valores de la imagen que se mapea a la paleta de colores: valores de Mg C/ha por debajo de 0 se pintan con el primer color de la paleta, por encima de 150 con el último, y los valores intermedios se interpolan proporcionalmente.
- **`palette: ['#ffffcc', '#41ab5d', '#005a32']`**: Rampa de color para la capa de carbono aéreo, de menor a mayor densidad: amarillo pálido (bajo carbono) pasando por verde medio hasta verde oscuro (alto carbono).
- **`palette: ['#fee5d9', '#de2d26']`**: Rampa de color para el carbono perdido: de un rosado pálido a un rojo intenso, para resaltar visualmente las zonas de pérdida.
- **`{ color: 'red' }`**: Para una `FeatureCollection` (acá, el AOI), define el color de sus bordes/relleno usando un código de color CSS o hexadecimal.
- **`false` (último argumento en la capa del AOI)**: Hace que esa capa se agregue al mapa pero permanezca oculta hasta que el usuario la active manualmente desde el panel Layers.

## Paso 6: Exportar resultados

Se deja preparado (comentado) el bloque para exportar la capa de carbono aéreo como imagen a Google Drive.

```javascript
/*
Export.image.toDrive({
	image: carbonoORNL,
	description: 'carbono_aereo_aoi',
    region: geomBounds,
    scale: ESCALA,
    maxPixels: MAXPIX
});
*/
```

**Parámetros:**
- **`Export.image.toDrive({...})`**: Genera una tarea de exportación de una imagen a Google Drive. La tarea queda pendiente en la pestaña "Tasks" del editor y debe iniciarse manualmente (botón "Run").
- **`image`**: La imagen a exportar; acá, la capa de carbono aéreo (ORNL) ya recortada al AOI.
- **`description`**: Nombre de la tarea (visible en la pestaña Tasks) y, por defecto, también el nombre base del archivo de salida.
- **`region`**: El área geográfica a exportar. Se usa `geomBounds` (el rectángulo envolvente) por la misma razón de rendimiento explicada en el Paso 1; como la imagen ya está enmascarada al AOI real, el archivo exportado solo tendrá datos válidos dentro de esa forma, aunque el rectángulo sea más grande.
- **`scale`**: Resolución en metros del archivo exportado.
- **`maxPixels`**: Límite máximo de píxeles que la tarea de exportación puede procesar antes de fallar.

**Código completo:** [https://code.earthengine.google.com/e1e695b23f6de1b60908fe8d11b68098](https://code.earthengine.google.com/e1e695b23f6de1b60908fe8d11b68098)
