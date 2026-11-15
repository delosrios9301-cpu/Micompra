# Publicación automática de Mi Compra sin claves privadas

El destino de producción es **Firebase Hosting** del proyecto `mi-compra-d9717`.

## Seguridad
- GitHub Actions obtiene credenciales temporales a través de **OIDC + Workload Identity Federation**.
- No se crean ni descargan claves privadas JSON.
- Solo se acepta el repositorio `delosrios9301-cpu/Micompra` (ID estable `1449815159`), propietario `285096474`, rama `main`.
- La cuenta de servicio solo recibe `roles/firebasehosting.admin` y `roles/serviceusage.apiKeysViewer`, sin roles sobre Firestore ni acceso a las cuentas de usuarios.
- El workflow ejecuta pruebas y genera el paquete `dist` antes de publicar exclusivamente `hosting`.
- No se modifica el plan Spark ni se habilita facturación mediante el script.

## Configuración inicial (se hace una sola vez)
1. Abre **Google Cloud Shell** en el proyecto `mi-compra-d9717`. Debes tener permisos IAM suficientes.
2. Ejecuta estos comandos desde tu copia existente del repositorio:

   ```bash
   cd ~/Micompra
   git pull --ff-only origin main
   bash scripts/setup-firebase-wif.sh
   ```

   Si no existe la carpeta, clona primero:
   ```bash
   git clone https://github.com/delosrios9301-cpu/Micompra.git
   cd Micompra
   bash scripts/setup-firebase-wif.sh
   ```

3. El script imprime el número del proyecto. En **GitHub > Settings > Secrets and variables > Actions > Variables**, crea la variable de repositorio:
   - **Name:** `FIREBASE_GCP_PROJECT_NUMBER`
   - **Value:** el número de proyecto mostrado por Cloud Shell (solo dígitos).

   No uses **Secrets**, no introduzcas JSON, contraseñas ni claves privadas.

4. Puede tomar hasta **cinco minutos** la propagación de IAM. Después abre
   https://github.com/delosrios9301-cpu/Micompra/actions/workflows/firebase-hosting.yml,
   selecciona **Run workflow** en la rama `main` y comprueba que termine en verde.
5. Comprueba la versión publicada en https://mi-compra-d9717.web.app/.

## Funcionamiento automático
Después de la configuración inicial, cualquier `push` o fusión de cambios a `main` lanza la validación y publicación automática. Un fallo en pruebas impide el despliegue. Si falla Firebase, la versión anterior continúa en Hosting.

## Si ocurre un error
- **Falta FIREBASE_GCP_PROJECT_NUMBER:** agrega la variable en GitHub, no un secreto.
- **No se puede crear la identidad:** comprueba que el usuario de Cloud Shell tenga permisos de administrador de IAM y que la organización permita Workload Identity Federation.
- **IAM permission denied / invalid grant:** espera cinco minutos y vuelve a ejecutar el workflow; si persiste, revisa el proyecto, proveedor y las restricciones de repo/main.
- **Permisos insuficientes de Firebase CLI:** revisa las funciones de la cuenta `mi-compra-hosting-gh@mi-compra-d9717.iam.gserviceaccount.com`; no le concedas Owner ni Editor.
- **No aparecen cambios:** verifica que se publicó el workflow de Firebase y actualiza la PWA; una caché del service worker puede retrasar la visualización.
