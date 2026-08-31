# ☁️ Despliegue en la nube

Despliega Dardcor Code en VPS o Docker para acceso remoto y uso en producción.

---

## 🖥️ Despliegue en VPS

### Requisitos previos

- Ubuntu 20.04+ o distribución Linux similar
- Node.js 20+
- Git
- Acceso root o sudo

### Paso 1: Clonar el repositorio

```bash
git clone https://github.com/dardcor/dardcor-code.git
cd dardcor-code/app
```

### Paso 2: Instalar dependencias

```bash
npm install
```

### Paso 3: Compilar la aplicación

```bash
npm run build
```

### Paso 4: Configurar variables de entorno

Crea un archivo `.env` o exporta variables:

```bash
export JWT_SECRET="your-secure-secret-change-this-to-random-string"
export INITIAL_PASSWORD="your-secure-password"
export DATA_DIR="/var/lib/dardcor-code"
export NODE_ENV="production"
```

**Variables de entorno:**

| Variable | Por defecto | Descripción |
|----------|---------|-------------|
| `JWT_SECRET` | Auto-generado | **¡DEBE cambiarse en producción!** Usado para firmar tokens JWT |
| `INITIAL_PASSWORD` | `123456` | Contraseña de login del dashboard |
| `DATA_DIR` | `~/.dardcor-code` | Ruta de almacenamiento de la base de datos |
| `NODE_ENV` | `development` | Establece a `production` para despliegue |
| `ENABLE_REQUEST_LOGS` | `false` | Habilita logs de debug de request/response |

### Paso 5: Crear el directorio de datos

```bash
sudo mkdir -p /var/lib/dardcor-code
sudo chown $USER:$USER /var/lib/dardcor-code
```

### Paso 6: Iniciar la aplicación

```bash
npm run start
```

### Paso 7: Configurar PM2 para producción

PM2 mantiene tu aplicación corriendo y la reinicia en caso de crash:

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar Dardcor Code con PM2
pm2 start npm --name dardcor-code -- start

# Guardar la configuración de PM2
pm2 save

# Configurar PM2 para iniciar al arrancar el sistema
pm2 startup
# Sigue las instrucciones impresas por el comando anterior
```

**Comandos de gestión de PM2:**

```bash
# Ver logs
pm2 logs dardcor-code

# Reiniciar aplicación
pm2 restart dardcor-code

# Detener aplicación
pm2 stop dardcor-code

# Ver estado
pm2 status

# Monitorear recursos
pm2 monit
```

---

## 🐳 Despliegue con Docker

### Opción 1: Usando Dockerfile

Crea un `Dockerfile` en el directorio `app`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Build application
RUN npm run build

# Expose ports
EXPOSE 3000 20128

# Set environment variables
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# Create data directory
RUN mkdir -p /app/data

# Start application
CMD ["npm", "run", "start"]
```

**Build y Run:**

```bash
# Construir imagen
docker build -t dardcor-code .

# Ejecutar contenedor
docker run -d \
  --name dardcor-code \
  -p 3000:3000 \
  -p 20128:20128 \
  -e JWT_SECRET="your-secure-secret-change-this" \
  -e INITIAL_PASSWORD="your-secure-password" \
  -v dardcor-code-data:/app/data \
  dardcor-code
```

### Opción 2: Docker Compose

Crea `docker-compose.yml`:

```yaml
version: '3.8'

services:
  dardcor-code:
    build: .
    container_name: dardcor-code
    ports:
      - "3000:3000"
      - "20128:20128"
    environment:
      - NODE_ENV=production
      - JWT_SECRET=your-secure-secret-change-this
      - INITIAL_PASSWORD=your-secure-password
      - DATA_DIR=/app/data
    volumes:
      - dardcor-code-data:/app/data
    restart: unless-stopped

volumes:
  dardcor-code-data:
```

**Ejecutar con Docker Compose:**

```bash
# Iniciar servicios
docker-compose up -d

# Ver logs
docker-compose logs -f

# Detener servicios
docker-compose down

# Reconstruir y reiniciar
docker-compose up -d --build
```

---

## 🌐 Proxy reverso con Nginx

### ¿Por qué usar Nginx?

- Terminación SSL/TLS
- Mapeo de nombre de dominio
- Balanceo de carga
- Mejor seguridad

### Paso 1: Instalar Nginx

```bash
sudo apt update
sudo apt install nginx
```

### Paso 2: Configurar Nginx

Crea `/etc/nginx/sites-available/dardcor-code`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL certificates (use certbot to generate)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Proxy to Dardcor Code
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # SSE support - CRITICAL for streaming
        proxy_buffering off;
        proxy_read_timeout 86400;
    }

    # API endpoint
    location /v1 {
        proxy_pass http://localhost:20128;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # SSE support - CRITICAL for streaming
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

### Paso 3: Habilitar el sitio

```bash
# Crear enlace simbólico
sudo ln -s /etc/nginx/sites-available/dardcor-code /etc/nginx/sites-enabled/

# Probar configuración
sudo nginx -t

# Recargar Nginx
sudo systemctl reload nginx
```

### Paso 4: Configurar SSL con Let's Encrypt

```bash
# Instalar certbot
sudo apt install certbot python3-certbot-nginx

# Obtener certificado SSL
sudo certbot --nginx -d your-domain.com

# La auto-renovación se configura automáticamente
# Probar renovación
sudo certbot renew --dry-run
```

---

## 🔒 Consideraciones de seguridad

### 1. Cambiar credenciales por defecto

**CRÍTICO:** Cambia `JWT_SECRET` y `INITIAL_PASSWORD` antes del despliegue:

```bash
# Generar JWT secret seguro
openssl rand -base64 32

# Usa este valor para JWT_SECRET
export JWT_SECRET="generated-secret-here"
```

### 2. Configuración del firewall

```bash
# Permitir SSH
sudo ufw allow 22/tcp

# Permitir HTTP/HTTPS (si usas Nginx)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Si NO usas proxy reverso, permite los puertos de Dardcor Code
sudo ufw allow 3000/tcp
sudo ufw allow 20128/tcp

# Habilitar firewall
sudo ufw enable
```

### 3. Restringir el acceso al dashboard

Si solo necesitas acceso por API, restringe el puerto del dashboard:

```bash
# Solo permitir acceso localhost al dashboard
sudo ufw deny 3000/tcp
```

Accede al dashboard vía túnel SSH:

```bash
ssh -L 3000:localhost:3000 user@your-server.com
# Luego abre http://localhost:3000 en tu navegador
```

### 4. Actualizaciones regulares

```bash
# Actualizar paquetes del sistema
sudo apt update && sudo apt upgrade -y

# Actualizar Dardcor Code
cd /path/to/dardcor-code/app
git pull
npm install
npm run build
pm2 restart dardcor-code
```

### 5. Estrategia de respaldo

```bash
# Respaldar el directorio de datos
tar -czf dardcor-code-backup-$(date +%Y%m%d).tar.gz /var/lib/dardcor-code

# Respaldo automatizado diario (agregar a crontab)
0 2 * * * tar -czf /backups/dardcor-code-$(date +\%Y\%m\%d).tar.gz /var/lib/dardcor-code
```

---

## 📊 Monitoreo

### Verificar el estado de la aplicación

```bash
# Estado PM2
pm2 status

# Ver logs
pm2 logs dardcor-code --lines 100

# Monitorear recursos
pm2 monit
```

### Logs de Nginx

```bash
# Logs de acceso
sudo tail -f /var/log/nginx/access.log

# Logs de error
sudo tail -f /var/log/nginx/error.log
```

### Recursos del sistema

```bash
# Uso de CPU y memoria
htop

# Uso de disco
df -h

# Conexiones de red
netstat -tulpn | grep -E '3000|20128'
```

---

## 🚨 Solución de problemas

### La aplicación no inicia

```bash
# Verificar logs
pm2 logs dardcor-code

# Verificar si los puertos están en uso
sudo lsof -i :3000
sudo lsof -i :20128

# Verificar variables de entorno
pm2 env dardcor-code
```

### Nginx 502 Bad Gateway

```bash
# Verificar si Dardcor Code está corriendo
pm2 status

# Verificar logs de error de Nginx
sudo tail -f /var/log/nginx/error.log

# Probar configuración de Nginx
sudo nginx -t
```

### El streaming SSE no funciona

Asegúrate de que `proxy_buffering off` esté configurado en Nginx para soporte SSE.

### Errores de permiso denegado

```bash
# Corregir permisos del directorio de datos
sudo chown -R $USER:$USER /var/lib/dardcor-code
chmod 755 /var/lib/dardcor-code
```

---

## 🔗 Próximos pasos

- [Conectar proveedores](/providers/subscription.md)
- [Configurar combos](/features/combos.md)
- [Integrar con herramientas](/integration/cursor.md)
