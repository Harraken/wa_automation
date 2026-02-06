# Reconstruire l’API pour activer Capture Click

L’erreur `Route POST /sessions/.../capture-click/start not found` signifie que le conteneur API utilise une ancienne image. Reconstruisez l’image sans cache puis redémarrez :

```powershell
cd c:\Users\harra\Desktop\whatsapp-auto-web

# Reconstruire uniquement le service API (sans cache pour être sûr)
docker-compose build --no-cache api

# Redémarrer le conteneur API
docker-compose up -d api
```

Si vous préférez tout reconstruire (api + worker) :

```powershell
docker-compose build --no-cache api worker
docker-compose up -d api worker
```

Ensuite, rafraîchissez la page (F5 ou Ctrl+F5) et réessayez « Capture Click ».
