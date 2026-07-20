---
layout: page
title: 04_Área_GlobalEcosystemTypology
parent: "Introducción a GEE"
nav_order: 5
---

# 04_Área_GlobalEcosystemTypology
## Objetivo
1. Definir un área de interés (Parque Nacional Chingaza).
2. Calcular el área de cada tipo de ecosistema interceptado con el ROI, usando el mapa global de la IUCN y el mapa nacional de Colombia.
3. Visualizar los ecosistemas IUCN coloreados por categoría, con leyenda dinámica.
4. Exportar las estadísticas de ambos mapas a Google Drive.

## Datos
- Áreas protegidas (WDPA), collection: `WCMC/WDPA/current/polygons`
<p align="center">
  <img src="{{ '/images/intro-gee/fig14.png' | relative_url }}" width="600" style="margin: 10px 0;">
</p>

- Tipología Global de Ecosistemas (IUCN), collection: `IUCN/GlobalEcosystemTypology/current`

<p align="center">
  <img src="{{ '/images/intro-gee/fig13.png' | relative_url }}" width="600" style="margin: 10px 0;">
</p>

- Mapa de ecosistemas de Colombia (asset del proyecto), collection: `projects/ee-paulapaz1101/assets/biodiversity_workshop/GEODATA/ecosystem_map_COL`

## Método
1. Intersección de geometrías con `.intersection()` para recortar cada ecosistema al límite exacto del área protegida.
2. Cálculo de área con `.area()`, convertida de m² a hectáreas.
3. Agrupación y suma de áreas por categoría de ecosistema usando `reduceColumns()` con `ee.Reducer.sum().group()`.

## Paso a paso

### Paso 1: Definir el área de interés
Cargar la colección de áreas protegidas (`WCMC/WDPA/current/polygons`) y filtrarla con `ee.Filter.eq()` para obtener el polígono correspondiente al Parque Nacional Chingaza. Centrar el mapa sobre el resultado.

```javascript
var WDPA = ee.FeatureCollection("WCMC/WDPA/current/polygons");
var roi = WDPA.filter(
  ee.Filter.eq('NAME', 'Chingaza'));

var roi = roiPA.geometry().dissolve(ee.ErrorMargin(1));

Map.centerObject(roi, 10);
```

<!-- > **Nota técnica:** aquí `roi` es una `FeatureCollection` (puede contener más de un polígono si el área protegida está dividida en varias partes). Si más adelante notas inconsistencias en los cálculos de área, considera usar `roi.geometry().dissolve()` para trabajar con una única geometría unificada en las funciones de intersección. -->

**Nota técnica:** `roiPA` conserva la `FeatureCollection` original (útil para visualizar en el mapa con sus atributos), mientras que `roi` es la geometría ya disuelta, que es la que se va usar en todos los cálculos de intersección y área más adelante. 

### Paso 2: Crear la función para calcular área por categoría

Definir `calcularAreaPorCategoria()`, que recibe cualquier colección de ecosistemas, el ROI, el nombre del campo de categoría (varía según el dataset) y el nombre que tendrá esa categoría en el resultado final. La función recorta cada polígono al ROI, calcula su área en hectáreas, descarta fragmentos menores a 0.1 ha, y agrupa/suma las áreas por categoría en un solo paso usando `reduceColumns()`.

# Parámetros de entrada:
- coleccion: la FeatureCollection de ecosistemas a analizar (ej. IUCN o Colombia).
- roiGeom: la geometría del área de interés (ej. Chingaza).
- campoCategoria: el nombre del campo que identifica el tipo de ecosistema en esa colección específica (ej. 'efg_code' para IUCN, 'ecos_gener' para Colombia - revisar en cada dataset).
- nombreSalida: el nombre que quieres que tenga esa categoría en el resultado final (ej. 'EFG_Code', 'Ecos_Gener').

Función parte 1:
a.calcula área de cada polígono individual que se sobrepone en ROI
b.  calcula el área  en m2 y convierte el valor en ha
Retorna: área, categoria 


```javascript
function calcularAreaPorCategoria(coleccion, roiGeom, campoCategoria, nombreSalida) {
  var conArea = coleccion.filterBounds(roiGeom).map(function(feature) {
    var interseccion = feature.geometry().intersection(roiGeom, ee.ErrorMargin(1));
    var areaHa = interseccion.area(ee.ErrorMargin(1)).divide(10000);
    return feature.set('Area_Ha', areaHa)
                  .set('Categoria', feature.get(campoCategoria));
  }).filter(ee.Filter.gt('Area_Ha', 0.1));

  var agrupado = conArea.reduceColumns({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'Categoria'}),
    selectors: ['Area_Ha', 'Categoria']
  });

  return ee.FeatureCollection(
    ee.List(agrupado.get('groups')).map(function(g) {
      g = ee.Dictionary(g);
      var props = {'Area_Total_Ha': g.get('sum')};
      props[nombreSalida] = g.get('Categoria');
      return ee.Feature(null, props);
    })
  );
}
```

### Paso 3: Calcular las estadísticas del mapa global de la IUCN

```javascript
var typologyFC = ee.FeatureCollection("IUCN/GlobalEcosystemTypology/current");
var statsUnificadas = calcularAreaPorCategoria(typologyFC, roi, 'efg_code', 'EFG_Code');
```



