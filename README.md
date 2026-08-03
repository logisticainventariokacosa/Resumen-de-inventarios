# KACOSA · Dashboard de Inventarios

## 1. Desplegar el backend (Apps Script)

1. Abre el Google Sheet **Maestro_Inventario** (ID `1YE-FwqO6Zt6FO-0Dv3uMHVCUWxX3msPoN-UQTzez0hI`).
2. Menú **Extensiones → Apps Script**.
3. Borra el contenido del editor y pega todo el contenido de `Code.gs`.
4. Guarda (ícono de disco).
5. Arriba a la derecha: **Implementar → Nueva implementación**.
   - Tipo: **Aplicación web**.
   - Descripción: `dashboard-v1`.
   - Ejecutar como: **Yo** (tu cuenta).
   - Quién tiene acceso: **Cualquier usuario**.
6. Clic en **Implementar**. Autoriza los permisos (verás una advertencia de Google porque es un script propio; clic en "Avanzado" → "Ir a [nombre del proyecto]").
7. Copia la **URL que termina en `/exec`**. Esa es tu API.
8. Prueba en el navegador: `TU_URL/exec?action=resumen` — debe devolver un JSON con las 6 cifras del dashboard.

⚠️ Cada vez que edites `Code.gs`, debes hacer **Implementar → Administrar implementaciones → editar (lápiz) → Nueva versión → Implementar** para que los cambios se reflejen en la URL pública.

## 2. Conectar el frontend

1. Abre `index.html`.
2. Busca la línea:
   ```js
   const API_URL = 'PEGA_AQUI_TU_URL_DE_APPS_SCRIPT';
   ```
3. Reemplázala con la URL `/exec` del paso anterior.

## 3. Crear el repositorio en GitHub y publicar (GitHub Pages)

```bash
# Dentro de la carpeta con index.html y Code.gs
git init
git add .
git commit -m "Dashboard inicial KACOSA"

# Crea el repo en GitHub (via web o gh CLI) y luego:
git remote add origin https://github.com/TU_USUARIO/kacosa-dashboard.git
git branch -M main
git push -u origin main
```

Luego en GitHub:
1. Ve a **Settings → Pages** del repositorio.
2. En "Source" selecciona la rama `main` y carpeta `/ (root)`.
3. Guarda. En 1-2 minutos tu dashboard estará en:
   `https://TU_USUARIO.github.io/kacosa-dashboard/`

Esa URL funciona desde cualquier PC, tablet o celular.

## 4. Fuentes combinadas (actualizado)

- **Tiendas:** se combinan `Maestro_Conteo_Completo` + `Tiendas_Upi` + `Grupo_Pepetodo` (verificado que no se solapan por `UNIQUE_ID`, son datos complementarios de distintos grupos de tiendas).
- **Stock por tienda:** se combinan `Maestro_SAP` + `Maestro_SAP_UPI` + `Maestro_SAP_GRUPO_PEPETODO`.
- **Casa Matriz:** se combinan `INVENTARIO GENERAL 2026 OK` + `CONTEO GENERAL` + `CONTEO EXHB` (99% de los códigos en estas 2 últimas no estaban en la primera, así que se suman sin duplicar).
- Si en el futuro agregas otro grupo de tiendas (ej. "Grupo_X"), solo agrégalo al arreglo `SHEETS.conteo` y `SHEETS.maestroSap` en `Code.gs`.

## 5. Notas importantes / supuestos que hice

- **No usé** las hojas `Estadisticas_Centro_Activo`, `Estadisiticas_Inventario_Activo` ni `ESTADISTICAS` porque me confirmaste que no están funcionando. Todo se calcula en vivo desde `Maestro_Conteo_Completo` (tiendas) e `INVENTARIO GENERAL 2026 OK` (Casa Matriz).
- Para Casa Matriz asumí que la hoja **`INVENTARIO GENERAL 2026 OK `** (con espacio al final del nombre) es la vista vigente, porque sus fechas coinciden con el rango actual (17/06 al 18/07/2026). Si no es así, dime cuál hoja usar.
- Casa Matriz se trata siempre como **activa** (cuenta de forma continua) — si en algún momento debe poder marcarse como cerrada, dime cómo se identifica eso.
- "Total stock" = cantidad de códigos (filas) en `Maestro_SAP` por centro, según me indicaste.
- El caché dura 5 minutos (`CACHE_SECONDS`) para no recalcular en cada clic — ajústalo si necesitas datos más al instante.
- Los nombres de hoja `matrizStock` (`STOCK KACOSA AL 09-07-2026`) cambian de nombre con la fecha en el documento — cuando actualices esa hoja, actualiza también ese nombre en `Code.gs`, o mejor, renómbrala siempre igual (ej. `STOCK KACOSA VIGENTE`) para no tener que tocar el código.

