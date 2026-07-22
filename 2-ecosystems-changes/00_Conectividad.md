---
layout: page
title: 00_Conectividad
parent: "Introducción a Embedding"
nav_order: 1
---

## 00_Corredores_Conectividad_geemap

# Objetivo
Este notebook calcula un **corredor de conectividad ecológica de costo mínimo** entre dos áreas protegidas (AP), combinando Google Earth Engine (vía `geemap`) para construir una matriz de resistencia multicriterio, y Python (`scikit-image`) para el análisis de costo-distancia. Todo el flujo corre en un único notebook de Google Colab, sin pasos manuales de exportación/importación entre GEE y Python.

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

**Código completo:** [https://colab.research.google.com/drive/14rxxDr-bTf7AhS1nl65rnkolJwH37k9M?usp=sharing](https://colab.research.google.com/drive/14rxxDr-bTf7AhS1nl65rnkolJwH37k9M?usp=sharing)
