# Regional Biodiversity Workshop

Este repositorio tiene el contenido del taller **Regional Biodiversity Workshop**, incluyendo instrucciones paso a paso, materiales de apoyo y scripts de Google Earth Engine (GEE). Está configurado como un sitio web mediante `github-pages`.

## Contenido del taller

El taller está organizado en tres módulos:

- **[1. Introducción a Google Earth Engine](1-intro-to-gee/)** — Fundamentos de JavaScript, visualización de imágenes satelitales, filtrado de colecciones Landsat/Sentinel-2, y análisis de ecorregiones y carbono.
- **[2. Cambios en ecosistemas](2-ecosystems-changes/)** — Análisis de similitud y detección de cambios usando embeddings satelitales.
- **[3. Biomasa aérea (AGB)](3-agb-biomass/)** — Estimación de biomasa aérea con embeddings satelitales.

## Scripts

Los scripts de Google Earth Engine usados en cada sesión están en la carpeta [`scripts/`](scripts/), organizados por día (`day_1`, `day_2`, `day_3`).

## Estructura del repositorio

Este repositorio es una plantilla para configurar un sitio web con [`github-pages`](https://pages.github.com/) que aloja todo el contenido (instrucciones paso a paso, diapositivas, código) de talleres de capacitación.

```
biodiversity_workshop/
├── 1-intro-to-gee/         # Material y guías del día 1
├── 2-ecosystems-changes/   # Material y guías del día 2
├── 3-agb-biomass/          # Material y guías del día 3
├── scripts/                # Scripts de GEE organizados por día
├── images/                 # Imágenes y figuras usadas en el sitio
├── index.md                # Página principal del sitio
├── partners.md             # Socios y colaboradores
├── resources.md            # Recursos adicionales
└── _config.yml             # Configuración de GitHub Pages
```
:construction: Under Construction :construction:

:construction: Everything below this line is under construction and not final :construction:

<!-- ## Configuration

The repository is configured according to the following structure:

```
repository (caribbean-trainings)
├── config.yml
├── README.md
├── index.md
├── _includes
│   ├── head_custom.html
│   ├── head.html
├── lesson1/day1 ("intro-to-gee")
│   ├── lesson1/day1.md ("intro-to-gee.md")
│   ├── introduction.md
│   ├── topic1.md
│   ├── topic2.md
│   ├── .....
├── lesson2/day2 ("ecosystem-change")
│   ├── lesson1/day1.md ("ecosystem-change.md")
│   ├── introduction.md
│   ├── topic1.md
│   ├── topic2.md
│   ├── .....
├── ..... (other lessons/days)
├── images
│   ├── lesson1/day1-images ("intro-to-remote-sensing-images")
│   │   ├── file.png ("reflected-energy-radiation.png")
│   │   ├── .....
│   ├── lesson2/day2-images
│   │   ├── .....
├── partners
├── resources

```

github desktop and external editor

markdown 

repository vs website -->

<!-- ## Setup Instructions

### Using this template

1. Click on `Use this template` and then `Create new repository` to create a new repository for your workshop. Select the location, name, and description of the repository as you desire.

<img align="center" src="./images/use-this-template.png"  vspace="10" width="800">

Alternative: If you are a member of the SERVIR-Amazonia repository, you can select it directly when creating a new repository:

<img align="center" src="./images/new-repo.png"  vspace="10" width="800">

<img align="center" src="./images/repo-template.png"  vspace="10" width="800">

### Setting up the github-page

1. To set up the `github-pages`, in your new repository, go to `Settings` and then `Pages`. Select the branch you want to use for the website. Usually it is `main`.

<img align="center" src="./images/pages.png"  vspace="10" width="800">

2. Then, hit `Save`.

<img align="center" src="./images/page-save.png"  vspace="10" width="400">

3. Go back to your repository's main page, and click on the gear icon next to `About` on the right side.

<img align="center" src="./images/about.png"  vspace="10" width="800">

4. Under `Website`, check the option "Use your GitHub Pages website" and click on `Save changes`. Now you can see the URL on the repository's main page.

<img align="center" src="./images/page-website.png"  vspace="10" width="600">

<img align="center" src="./images/page-url.png"  vspace="10" width="800">

5. Open it to see how it looks like at this first moment. It will look like the `caribbean-trainings` page.

<img align="center" src="./images/page-open.png"  vspace="10" width="800">

The following changes will reflect how your github page looks like.

### Customizing the repository to your training

1. Update the `README.md` file with the description of your repository.

2. Update the `config.yml` file with the details of your workshop. The changes here will reflect on the website.
    1. For `title`, add the title of your workshop
    2. For `description`, add a short description
    3. The `baseurl` is the subpath of your site, e.g.: `/NAME-OF-REPOSITORY`. Add the name of the repository so that it matches the website URL `https://servir-amazonia.github.io/NAME-OF-REPOSITORY`.
    4. The `url` is the base hostname & protocol for your site, `https://servir-amazonia.github.io`. You shouldn't change this unless the repository is not in the SERVIR-Amazonia github organization.
    5. For `logo`, you can add the name of a png file that contains the logo you desire. This file should be put under the `images` folder of your repository. Currently, the logo file is a png image that contains the SERVIR-Amazonia partners' logos. Don't change this if it is a SERVIR-Amazonia workshop.
    6. The `remote-theme` is the theme used for the github page. We use the Jekyll theme by `just-the-docs` but there are many more options. You can find more information about `just-the-docs` here: [https://just-the-docs.com/](https://just-the-docs.com/). Don't change this unless you are planning to use another theme. Note that using another theme may desconfigure the format of elements on the website.

3. Under the `_includes` folder, you will find two files. You don't need to worry about the `head.html` file. In the `head_custom.html` file, you can change the favicon that shows up next to the website description when you have the website open in a tab:

<img align="center" src="./images/favicon.png"  vspace="10" width="300">

Currently, the file is SIG's favicon, but you can change it to your organization's favicon. To change it, update the file name in `href="images/favicon.ico"`. Note: you will need to add a new file containing the favicon in the `images` folder, or replace the existing `favicon.ico` file if you intend to use the same file name.

4. Got to the `index.md` file and update the title according to your country or workshop/training.

<img align="center" src="./images/index-country-name.png"  vspace="10" width="800">

<img align="center" src="./images/index-country-name-githubpages.png"  vspace="10" width="800">

5. In the same `index.md` file, the `Questions`, `Feedback`, and `Workshop Recordings` sections are buttons that link into specific Google Forms or Drive folders. Update the URLs appropriately - you will need to create new Google forms and folders in your Drive folder.

e.g.: Update the https://forms.gle/8Jdm1aybL9sqzNEw6 URL in `[Give Feedback](https://forms.gle/8Jdm1aybL9sqzNEw6){: .btn .btn-purple }`.

6. You can use the [Tables Generator](https://www.tablesgenerator.com/markdown_tables) to update the workshop `Agenda` in the `index.md` file (easier when you have a table already, e.g. on a doc or spreadsheet): 

<img align="center" src="./images/agenda-raw.png"  vspace="10" width="800">

<img align="center" src="./images/agenda-githubpages.png"  vspace="10" width="800"> --> -->

