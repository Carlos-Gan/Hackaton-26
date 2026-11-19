# Firebase para Repostería La Esquina

## Configuración local

La configuración web que se compartió está en `.env.local` (ese archivo no se sube a Git). El ID de empresa activo es `pasteleria-dulce`. Reinicia `npm run dev` después de cambiar variables `VITE_*`.

## Firestore

1. En Firebase Console, crea la base en **Firestore Database**.
2. Publica las reglas de `firestore.rules` en **Firestore Database → Rules**.
3. En **Authentication → Sign-in method**, habilita **Correo electrónico/contraseña**.
4. En **Authentication → Users**, crea la cuenta del negocio. Inicia sesión desde **Dashboard**; el panel mostrará el UID de esa cuenta.
5. En Firestore, crea un documento en `empresas/pasteleria-dulce/miembros` usando ese UID como ID. Puede tener, por ejemplo, `{ "rol": "owner" }`.
6. Dentro de `empresas/pasteleria-dulce`, crea documentos en la subcolección `productos`. Ejemplo de documento:

```json
{
  "nombre": "Pastel de Chocolate",
  "precio": 225,
  "stock": 2,
  "activo": true
}
```

El chat lee `empresas/pasteleria-dulce/productos` en tiempo real y limita la cantidad elegida al stock publicado. Al confirmar, crea un documento en `empresas/pasteleria-dulce/pedidos`; el dashboard muestra esos pedidos en tiempo real y solo permite leerlos a usuarios incluidos en `empresas/pasteleria-dulce/miembros`.

El stock se consulta antes de crear el pedido, pero todavía no se descuenta automáticamente. Para evitar sobreventa si dos personas compran a la vez, el siguiente paso es hacer el checkout con una transacción segura del lado servidor (Cloud Functions).
