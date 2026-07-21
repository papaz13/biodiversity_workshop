////////////////////////////////////////////////////////////////////////////////
// Taller: Regional Biodiversity Workshop
// Autor:  EEFA Book, capítulo F1
// Objetivo: Aprender lo básico para iniciar con JavaScript
////////////////////////////////////////////////////////////////////////////////


//Variables
var string = 'Hello, World!';
print(string);

var ciudad = 'Bogotá';
print(ciudad);
 
var poblacion = 7900000;
print(poblacion);

//Listas
var lista = [1.23, 8, -3];
print(lista[2]);

var ciudades = ['Bogotá', 'Cali', 'Medellín', 'Cartagena', 'Santa Marta'];
print(ciudades)

//Diccionario
var diccionario = {
  a: 'Hola',
  b: 10,
  c: 0.1343,
  d: lista
};
print(diccionario);
print(diccionario.b);

var datosCiudad = {
    'ciudad': 'Bogotá',
    'coordenadas': [-74.081,4.609],
    'poblacion': 7900000
};
print(datosCiudad);

// Funciones
var funcionHola = function(nombre){
  return 'Hola ' + nombre;
};

function funcionHola2(nombre){
  return 'Hola ' + nombre + ', mucho gusto en conocerte.';
}
print(funcionHola('Manuel'));
print(funcionHola2('Paula'));

