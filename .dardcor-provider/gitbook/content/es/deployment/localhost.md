# 🏠 Despliegue en localhost

Ejecuta Dardcor Code en tu máquina local para desarrollo y uso personal.

---

## 📦 Instalación

Instala Dardcor Code globalmente vía npm:

```bash
npm install -g dardcor-code
```

**Requisitos:**
- Node.js 20 o superior
- npm 9 o superior

---

## 🚀 Iniciar el servidor

Inicia Dardcor Code con un solo comando:

```bash
dardcor-code
```

El dashboard se abrirá automáticamente en tu navegador en `http://localhost:3000`

**Configuración por defecto:**
- **Dashboard**: `http://localhost:3000`
- **API Endpoint**: `http://localhost:21128/v1`
- **Directorio de datos**: `~/.dardcor-code`

---

## 🔧 Configuración

### Directorio de datos personalizado

Establece un directorio de datos personalizado usando una variable de entorno:

```bash
DATA_DIR=/path/to/data dardcor-code
```

### Puerto personalizado

El puerto de API (21128) y el puerto del dashboard (3000) están configurados en la aplicación. Para cambiarlos, necesitarás modificar el código fuente o usar variables de entorno si se soportan.

---

## 🛑 Detener el servidor

Presiona `Ctrl+C` en la terminal donde Dardcor Code se está ejecutando.

```bash
# En la terminal ejecutando dardcor-code
^C  # Presiona Ctrl+C
```

El servidor se apagará correctamente y guardará todos los datos.

---

## 🔄 Reiniciar el servidor

Simplemente ejecuta el comando de inicio nuevamente:

```bash
dardcor-code
```

Todas tus configuraciones, API keys y combos se preservan en el directorio de datos.

---

## 📊 Actualizar Dardcor Code

Actualiza a la última versión:

```bash
npm update -g dardcor-code
```

Verifica tu versión actual:

```bash
npm list -g dardcor-code
```

---

## 🔍 Solución de problemas

### Puerto ya en uso

Si el puerto 21128 o 3000 ya está en uso:

```bash
# Encontrar proceso usando el puerto (macOS/Linux)
lsof -i :21128
lsof -i :3000

# Matar el proceso
kill -9 <PID>
```

### Errores de permisos

Si encuentras errores de permisos durante la instalación:

```bash
# Usar sudo (no recomendado)
sudo npm install -g dardcor-code

# O corregir los permisos de npm (recomendado)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Problemas con el directorio de datos

Si el directorio de datos no es accesible:

```bash
# Verificar permisos
ls -la ~/.dardcor-code

# Corregir permisos
chmod 755 ~/.dardcor-code
```

---

## 📁 Estructura del directorio de datos

```
~/.dardcor-code/
├── db.json           # Main database (providers, combos, settings)
├── logs/             # Application logs
└── cache/            # Temporary cache files
```

**Respaldar tus datos:**

```bash
# Respaldo
cp -r ~/.dardcor-code ~/.dardcor-code.backup

# Restaurar
cp -r ~/.dardcor-code.backup ~/.dardcor-code
```

---

## 🔗 Próximos pasos

- [Conectar proveedores](/providers/subscription.md)
- [Crear combos](/features/combos.md)
- [Integrar con herramientas CLI](/integration/cursor.md)
