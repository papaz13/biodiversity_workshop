---
layout: page
title: 00_Básico_JavaScript
parent: "Introducción a GEE"
nav_order: 1
---


## 00_Básico_JavaScript

Para poder construir un script para su análisis, es necesario usar JavaScript. Esta sección cubre la sintaxis de JavaScript y las estructuras de datos básicas en Earth Engine.

## JavaScript

### Variables

En un lenguaje de programación, las variables se utilizan para almacenar valores de datos. En JavaScript, una variable se define usando la palabra clave `var` seguida del nombre de la variable. El siguiente código asigna el texto "Bogotá" a la variable denominada `ciudad`. Tenga en cuenta que la cadena de texto en el código debe estar entre comillas. Puede usar `'` (comillas simples) o `"` (comillas dobles), y deben coincidir al principio y al final de cada cadena. En sus programas, es recomendable ser coherente: use comillas simples o comillas dobles en todo una secuencia de comandos determinada. Cada declaración de su secuencia de comandos debe terminar normalmente con un punto y coma, aunque el editor de código de Earth Engine no lo requiere.

Si imprime (`print`) la variable `ciudad`, obtendrá el valor almacenado en la variable (Bogotá) impreso en el `Console`.

```javascript
var ciudad = 'Bogotá';
print(ciudad);
```

> **Nota de transcripción:** en el script original, la segunda línea decía `print(variable);` en lugar de `print(ciudad);`. `variable` no está declarada en ningún lado del script, así que esa línea generaría un error ("variable is not defined") en el editor de GEE. Se corrigió acá a `print(ciudad)`, que es lo que efectivamente imprime el valor recién asignado.

Cuando se asigna un valor de texto, a la variable se le asigna automáticamente el tipo *string*. También se pueden asignar números a variables y crear variables de tipo *número*. El siguiente código crea una nueva variable llamada `poblacion` y le asigna un número como su valor.

```javascript
var poblacion = 7900000;
print(poblacion);
```

### Listas

Es útil poder almacenar múltiples valores en una sola variable. JavaScript proporciona una estructura de datos llamada "lista" (*array*) que puede contener múltiples valores. Se puede crear una nueva lista usando los corchetes `[]` y agregando múltiples valores separados por comas.

```javascript
var ciudades = ['Bogotá', 'Cali', 'Medellín', 'Cartagena', 'Santa Marta'];
print(ciudades);
```

Si se observa la salida en la Consola, se verá `"List"` con una flecha de expansión (▹) al lado. Al hacer clic en la flecha, se expande la lista y se muestra su contenido. Junto con los elementos de la lista, hay un número al lado de cada valor: es el índice de cada elemento, y permite hacer referencia a cada uno mediante un valor numérico que indica su posición en la lista.

### Objetos JavaScript

Las listas permiten almacenar múltiples valores en una sola variable contenedora. Si bien es útil, no es apropiado para almacenar datos estructurados, donde es preferible poder hacer referencia a cada elemento por su nombre en lugar de por su posición. Los objetos en JavaScript permiten almacenar pares clave-valor, donde cada valor se referencia por su clave. Se puede crear un objeto (a veces llamado *diccionario*) usando llaves `{}`. El siguiente código crea un objeto llamado `datosCiudad` con información sobre Bogotá.

Tenga en cuenta algunas cosas importantes sobre la sintaxis de JavaScript aquí. Primero, se pueden usar varias líneas para definir el objeto; solo cuando se coloca el punto y coma (`;`) el comando se considera completo. Esto ayuda a formatear el código para que sea más legible.

```javascript
var datosCiudad = {
    'ciudad': 'Bogotá',
    'coordinadas': [-74.081,4.609],
    'poblacion': 7900000
};
print(datosCiudad);
```

### Funciones

Mientras se usa Earth Engine, es frecuente necesitar definir funciones propias. Las funciones toman entradas del usuario, las usan para realizar algún cálculo y devuelven una salida. Permiten agrupar un conjunto de operaciones y repetirlas con diferentes parámetros sin tener que volver a escribirlas cada vez. Se definen utilizando la palabra clave `function`. El siguiente código define una función llamada `saludo` que toma una entrada llamada `nombre` y devuelve un saludo con el prefijo `Hola`. Se puede llamar a la función con distintas entradas, y genera distintas salidas con el mismo código.

```javascript
var saludo = function(nombre) {
    return 'Hola ' + nombre;
};
print(saludo('Mundo'));
print(saludo('Participantes'));
```

JavaScript también permite declarar funciones con una sintaxis alternativa (declaración con nombre, en vez de asignarlas a una variable):

```javascript
function funcionHola2(nombre){
  return 'Hola ' + nombre + ', mucho gusto en conocerte.';
}
print(funcionHola2('Manuel'));
print(funcionHola2('Paula'));
```

> **Nota de transcripción:** en el script original, la función se declaraba como `funcionHola2`, pero la primera línea de `print` llamaba a `funcionHola` (sin el `2`), una función que nunca se definió en el script. Eso generaría un error ("funcionHola is not defined"). Se corrigió acá para que ambas líneas llamen a `funcionHola2`, que es la única función realmente declarada en este bloque.

### Comentarios

Mientras se escribe código, es útil agregar texto para explicarlo o dejar una nota. Es una buena práctica de programación agregar siempre comentarios explicando cada paso. En JavaScript, se puede prefijar cualquier línea con dos barras diagonales `//` para convertirla en un comentario; el intérprete ignora el texto del comentario y no lo ejecuta.

```javascript
// ¡Comentario!
```

El Editor de código también proporciona un atajo (`Ctrl + /` en Windows, `Cmd + /` en Mac) para comentar o descomentar varias líneas a la vez. Se pueden seleccionar varias líneas y presionar la combinación de teclas para convertirlas todas en comentarios; al pulsar de nuevo se revierte la operación. Esto es útil al depurar código, para detener temporalmente la ejecución de ciertas partes del script.

**Código completo:** Script `00_Básico_JavaScript` del repositorio, carpeta `day_1`, o enlace directo: [https://code.earthengine.google.com/634c52426782f6c280517c558fba80dd?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop](https://code.earthengine.google.com/634c52426782f6c280517c558fba80dd?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop)
00_Basico_JavaScript.md
Mostrando 00_Basico_JavaScript.md.


<!-- # 00_Básico_JavaScript
Para poder construir un script para su análisis, necesitará usar JavaScript. Esta sección cubre la sintaxis de JavaScript y las estructuras de datos básicas en Earth Engine.

# JavaScript

## Variables
En un lenguaje de programación, las variables se utilizan para almacenar valores de datos. En JavaScript, una variable se define usando la palabra clave `var` seguida del nombre de la variable. El siguiente código asigna el texto "Bogota" a la variable denominada `ciudad`. Tenga en cuenta que la cadena de texto en el código debe estar entre comillas. Puede usar ' (comillas simples) o " (comillas dobles), y deben coincidir al principio y al final de cada cadena. En sus programas, es recomendable ser coherente: use comillas simples o comillas dobles en todo una secuencia de comandos determinada. Cada declaración de su secuencia de comandos debe terminar normalmente con un punto y coma, aunque el editor de código de Earth Engine no lo requiere.

Si imprime `print` la variable `ciudad`,  obtendrá el valor almacenado en la variable (Bogotá) impreso en el `Console`.

```javascript
var ciudad = 'Bogotá';
print(variable);
```
Cuando asigna un valor de texto, a la variable se le asigna automáticamente el tipo *string*. También puede asignar números a variables y crear variables de tipo *número*. El siguiente código crea una nueva variable llamada `poblacion` y le asigna un número como su valor.

```javascript
var poblacion = 7900000;
print(poblacion);
```

### Listas

Es útil poder almacenar múltiples valores en una sola variable. JavaScript proporciona una estructura de datos llamada "lista" que puede contener múltiples valores. Podemos crear una nueva lista usando los corchetes [] y agregando múltiples valores separados por una coma.

```javascript
var ciudades = ['Bogotá', 'Cali', 'Medellín', 'Cartagena', 'Santa Marta'];
print(ciudades);
```

Si observa la salida en la Consola, verá "`List`" con una flecha de expansión (▹) al lado. Al hacer clic en la flecha, se expandirá la lista y se le mostrará su contenido. Notará que junto con los cuatro elementos de la lista, hay un número al lado de cada valor. Este es el índice de cada artículo. Le permite hacer referencia a cada elemento de la lista mediante un valor numérico que indica su posición en la lista.

### Objetos JavaScript

Las listas le permiten almacenar múltiples valores en una sola variable de contenedor. Si bien es útil, no es apropiado para almacenar datos estructurados. Es útil poder hacer referencia a cada elemento con su nombre en lugar de su posición. Los objetos en JavaScript le permiten almacenar pares clave-valor, donde se puede hacer referencia a cada valor por su clave. Puede crear un `diccionario` usando las llaves {}. El siguiente código crea un objeto llamado `datosCiudad` con información sobre Bogotá.

Tenga en cuenta algunas cosas importantes sobre la sintaxis de JavaScript aquí. Primero, podemos usar varias líneas para definir el objeto. Solo cuando ponemos el punto y coma (;) el comando se considera completo. Esto ayuda a formatear el código para que sea más legible. También tenga en cuenta la selección del nombre de variable `datosCiudad`. 

```javascript
var datosCiudad = {
    'ciudad': 'Bogotá',
    'coordinadas': [-74.081,4.609],
    'poblacion': 7900000
};
print(datosCiudad);
```

### Funciones

Mientras usa Earth Engine, deberá definir sus propias funciones. Las funciones toman las entradas del usuario, las usan para realizar algunos cálculos y envían una salida. Las funciones le permiten agrupar un conjunto de operaciones y repetir las mismas operaciones con diferentes parámetros sin tener que volver a escribirlas cada vez. Las funciones se definen utilizando la palabra clave `function`. El siguiente código define una función llamada `saludo` que toma una entrada llamada `nombre` y devuelve un saludo con el prefijo `Hola`. Tenga en cuenta que podemos llamar a la función con diferentes entradas y genera diferentes salidas con el mismo código.

```javascript
var saludo = function(nombre) {
    return 'Hola ' + nombre;
};
print(saludo('Mundo'));
print(saludo('Participantes'));
```

```javascript
function funcionHola2(nombre){
  return 'Hola ' + nombre + ', mucho gusto en conocerte.';
}
print(funcionHola('Manuel'));
print(funcionHola2('Paula'));
```

### Comentarios

Mientras escribe el código, es útil agregar un poco de texto para explicar el código o dejar una nota para usted. Es una buena práctica de programación agregar siempre comentarios en el código explicando cada paso. En JavaScript, puede prefijar cualquier línea con dos barras diagonales // para convertirlo en un comentario. El intérprete ignorará el texto del comentario y no se ejecutará.

```javascript
// ¡Comentario!
```

El Editor de código también proporciona un acceso directo (Ctrl + / en Windows, Cmd + / en Mac) para comentar o descomentar varias líneas a la vez. Puede seleccionar varias líneas y presionar la combinación de teclas para hacer que todos sean comentarios. Pulse de nuevo para invertir la operación. Esto es útil cuando se depura el código para detener la ejecución de ciertas partes del script.

### Código completo

Script "`00_Básico_JavaScript`" del repositorio y la carpeta `day_1` o link directo:
[https://code.earthengine.google.com/634c52426782f6c280517c558fba80dd?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop](https://code.earthengine.google.com/634c52426782f6c280517c558fba80dd?asset=projects%2Fee-paulapaz1101%2Fassets%2Fbiodiversity_workshop) -->

