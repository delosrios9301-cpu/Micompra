#!/usr/bin/env bash
# One-time, keyless Firebase Hosting deployment authorization for Mi Compra.
# Ejecutar en Google Cloud Shell con una cuenta administradora del proyecto.
set -euo pipefail

PROJECT_ID="mi-compra-d9717"
POOL_ID="mi-compra-github"
PROVIDER_ID="mi-compra-main"
SA_ID="mi-compra-hosting-gh"
SA_EMAIL="$SA_ID@$PROJECT_ID.iam.gserviceaccount.com"
REPO_ID="1449815159"
REPO_OWNER_ID="285096474"
GITHUB_REPO="delosrios9301-cpu/Micompra"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: Abre Google Cloud Shell; se necesita gcloud." >&2
  exit 1
fi

echo "Proyecto Firebase: $PROJECT_ID"
echo "Repositorio autorizado: $GITHUB_REPO, exclusivamente rama main."
echo "Se creará una cuenta de servicio SOLO para publicar Hosting, sin claves privadas."
echo "No se modificarán Firestore, sus reglas, ni el plan de facturación."
echo

NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
if ! [[ "$NUMBER" =~ ^[0-9]+$ ]]; then
  echo "ERROR: No se pudo obtener el número del proyecto. Comprueba tu acceso." >&2
  exit 1
fi

echo "Habilitando APIs de identidad si fuese necesario..."
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  --project="$PROJECT_ID" --quiet

echo "Verificando cuenta de servicio exclusiva de Hosting..."
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_ID" \
    --project="$PROJECT_ID" \
    --display-name="Mi Compra Firebase Hosting GitHub" --quiet
fi

# Estos roles NO permiten editar los documentos de Firestore.
for ROLE in roles/firebasehosting.admin roles/serviceusage.apiKeysViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$ROLE" --condition=None --quiet >/dev/null
done

echo "Verificando pool de Workload Identity..."
if ! gcloud iam workload-identity-pools describe "$POOL_ID" \
    --project="$PROJECT_ID" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --project="$PROJECT_ID" --location=global \
    --display-name="Mi Compra GitHub" --quiet
fi

# Verifica la identidad estable del repositorio/propietario y restringe a main.
MAPPING="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref"
CONDITION="attribute.repository_id=='$REPO_ID' && attribute.repository_owner_id=='$REPO_OWNER_ID' && attribute.ref=='refs/heads/main'"
if gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
    --project="$PROJECT_ID" --location=global \
    --workload-identity-pool="$POOL_ID" >/dev/null 2>&1; then
  echo "Actualizando las restricciones del proveedor existente..."
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER_ID" \
    --project="$PROJECT_ID" --location=global \
    --workload-identity-pool="$POOL_ID" \
    --attribute-mapping="$MAPPING" \
    --attribute-condition="$CONDITION" --quiet
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --project="$PROJECT_ID" --location=global \
    --workload-identity-pool="$POOL_ID" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$MAPPING" \
    --attribute-condition="$CONDITION" \
    --display-name="Mi Compra main" --quiet
fi

POOL_RESOURCE="projects/$NUMBER/locations/global/workloadIdentityPools/$POOL_ID"
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" --condition=None \
  --member="principalSet://iam.googleapis.com/$POOL_RESOURCE/attribute.repository_id/$REPO_ID" \
  --quiet >/dev/null

echo
echo "CONFIGURACION DE GOOGLE CLOUD COMPLETADA (sin claves privadas)."
echo "Ahora, en GitHub > Settings > Secrets and variables > Actions > Variables,"
echo "crea una única VARIABLE DE REPOSITORIO (no un secret):"
echo
echo "Name:  FIREBASE_GCP_PROJECT_NUMBER"
echo "Value: $NUMBER"
echo
echo "Enlace: https://github.com/$GITHUB_REPO/settings/variables/actions"
echo "Finalmente ejecuta de nuevo: https://github.com/$GITHUB_REPO/actions/workflows/firebase-hosting.yml"
echo "Puede requerir hasta 5 minutos para propagar permisos de Google IAM."
