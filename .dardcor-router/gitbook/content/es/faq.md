# Preguntas frecuentes

Preguntas comunes sobre Dardcor Code.

---

## ¿Qué es Dardcor Code?

**Dardcor Code es un router de modelos de IA que maximiza el valor de tu suscripción y minimiza los costos.**

Enruta inteligentemente las solicitudes a través de múltiples proveedores de IA usando un sistema de fallback de 3 niveles:
1. **Nivel de suscripción** - Maximiza las cuotas de Claude Code, Codex, Gemini que ya pagas
2. **Nivel barato** - Alternativas ultra-baratas ($0.20-$0.60 por 1M tokens)
3. **Nivel gratis** - Respaldo de emergencia con modelos gratis ilimitados

**Beneficios clave:**
- Nunca desperdicies la cuota de suscripción
- Fallback automático cuando se agota la cuota
- Seguimiento de cuota en tiempo real
- 90% de ahorro en costos vs uso directo de API

---

## ¿Cómo funciona el precio?

**Dardcor Code usa una estrategia de precios de 3 niveles:**

### Nivel 1: Suscripción (Maximiza primero)
- **Claude Code** (Pro/Max): $20-100/mes - Cuota de 5 horas + semanal
- **OpenAI Codex** (Plus/Pro): $20-200/mes - Cuota de 5 horas + semanal
- **Gemini CLI**: GRATIS - 180K completados/mes + 1K/día
- **GitHub Copilot**: $10-19/mes - Reinicio mensual
- **Antigravity**: GRATIS - Similar a Gemini

**Objetivo:** ¡Usa cada bit de cuota antes de que se reinicie!

### Nivel 2: Barato (Respaldo)
- **GLM-4.7**: $0.60/$2.20 por 1M tokens - Reinicio diario 10AM
- **MiniMax M2.1**: $0.20/$1.00 por 1M tokens - 5 horas rolling
- **Kimi K2**: $9/mes plano (10M tokens)

**Objetivo:** ¡90% más barato que ChatGPT API ($20/1M)!

### Nivel 3: Gratis (Emergencia)
- **iFlow**: 8 modelos GRATIS (Kimi K2, Qwen3, GLM, MiniMax...)
- **Qwen**: 3 modelos GRATIS (Qwen3 Coder Plus/Flash, Vision)
- **Kiro**: 2 modelos GRATIS (Claude Sonnet 4.5, Haiku 4.5)

**Objetivo:** ¡Fallback de cero costo cuando todo lo demás está limitado por cuota!

---

## ¿Dardcor Code es gratis?

**Sí, Dardcor Code en sí es 100% gratis y open source.**

**Proveedores de nivel gratis disponibles:**
- **Gemini CLI** - 180K completados/mes (cuenta Google GRATIS)
- **iFlow** - 8 modelos ilimitados (OAuth GRATIS)
- **Qwen** - 3 modelos ilimitados (OAuth GRATIS)
- **Kiro** - Claude Sonnet/Haiku (AWS Builder ID GRATIS)

**¡Puedes codificar GRATIS para siempre usando solo proveedores de nivel gratis!**

**Proveedores de pago opcionales:**
- Servicios de suscripción que ya puedes tener (Claude Code, Codex, Copilot)
- Alternativas ultra-baratas ($0.20-$0.60 por 1M tokens)

---

## ¿Qué proveedores son compatibles?

### Proveedores de suscripción
- **Claude Code** (Pro/Max) - Claude 4.5 Opus/Sonnet/Haiku
- **OpenAI Codex** (Plus/Pro) - GPT 5.2 Codex, GPT 5.1 Codex Max
- **Gemini CLI** (GRATIS) - Gemini 3 Flash/Pro, 2.5 Pro/Flash
- **GitHub Copilot** - GPT-5, Claude 4.5, Gemini 3
- **Antigravity** (Google) - Gemini 3 Pro, Claude Sonnet 4.5

### Proveedores baratos
- **GLM** (Zhipu AI) - GLM 4.7, GLM 4.6V Vision
- **MiniMax** - MiniMax M2.1
- **Kimi** (Moonshot AI) - Kimi Latest
- **OpenRouter** - Passthrough a cualquier modelo de OpenRouter

### Proveedores gratis
- **iFlow** - 8 modelos (Kimi K2, Qwen3, GLM, MiniMax, DeepSeek...)
- **Qwen** - 3 modelos (Qwen3 Coder Plus/Flash, Vision)
- **Kiro** - 2 modelos (Claude Sonnet 4.5, Haiku 4.5)

**Total: 15+ proveedores, 50+ modelos**

Consulta la [documentación de proveedores](providers/subscription.md) para más detalles.

---

## ¿Puedo usar múltiples proveedores?

**¡Sí! Esta es la característica principal de Dardcor Code.**

**Los combos te permiten encadenar múltiples proveedores con fallback automático:**

```
Ejemplo de combo: "premium-coding"
1. cc/claude-opus-4-5 (Suscripción principal)
2. glm/glm-4.7 (Respaldo barato)
3. if/kimi-k2 (Emergencia gratis)

→ Cambio automático cuando se agota la cuota
→ Nunca para de codificar
→ Costo extra mínimo
```

**Cómo crear combos:**
```
Dashboard → Combos → Create New
→ Agrega modelos en orden de prioridad
→ Usa el nombre del combo en CLI: "premium-coding"
```

**Beneficios:**
- Cero tiempo de inactividad cuando se agota la cuota
- Optimización automática de costos
- Un solo nombre de modelo para todas las herramientas

Consulta la [documentación de combos](features/combos.md) para ejemplos.

---

## ¿Cómo funciona el seguimiento de cuota?

**Dardcor Code rastrea la cuota en tiempo real para todos los proveedores:**

**Características:**
- **Consumo de tokens** - Tokens de entrada/salida por solicitud
- **Cuenta regresiva de reinicio** - Tiempo hasta que se refresca la cuota
- **Estadísticas de uso** - Reportes diarios/semanales/mensuales
- **Estimación de costos** - Gasto proyectado (niveles de pago)
- **Alertas de cuota** - Notificaciones cuando la cuota es baja

**Tipos de cuota:**
- **5 horas rolling** - Claude Code, Codex, MiniMax
- **Reinicio diario** - Gemini CLI (1K/día), GLM (10AM)
- **Reinicio semanal** - Claude Code, Codex (cuota adicional)
- **Reinicio mensual** - Gemini CLI (180K), GitHub Copilot (día 1)

**Ver cuota:**
```
Dashboard → Providers → Quota Tracking
→ Uso en tiempo real + cuenta regresiva de reinicio
```

Consulta la [documentación de seguimiento de cuota](features/quota-tracking.md) para detalles.

---

## ¿Dardcor Code funciona con Cursor?

**Sí, pero Cursor requiere un endpoint en la nube.**

**Problema:** Cursor IDE no soporta endpoints en localhost.

**Solución:** Usa el despliegue en la nube de Dardcor Code:

```
Cursor Settings → Models → Advanced:
  OpenAI API Base URL: https://dardcor-code.web.id/v1
  OpenAI API Key: [desde el dashboard]
  Model: cc/claude-opus-4-5-20251101
```

**Alternativa:** Auto-hospéda en VPS con dominio público:
```bash
# Despliega en VPS
git clone https://github.com/dardcor/dardcor-code.git
cd dardcor-code/app
npm install && npm run build
npm start

# Configura proxy reverso Nginx
# Apunta Cursor a: https://your-domain.com/v1
```

**Otras herramientas CLI funcionan con localhost:**
- Cline ✅
- Claude Desktop ✅
- Codex CLI ✅
- Continue ✅
- RooCode ✅

Consulta la [guía de integración de Cursor](integration/cursor.md) para detalles.

---

## ¿Puedo auto-hospedar Dardcor Code?

**¡Sí! Dardcor Code soporta múltiples opciones de despliegue:**

### Localhost (Por defecto)
```bash
npm install -g dardcor-code
dardcor-code
→ Dashboard: http://localhost:3000
→ API: http://localhost:20128/v1
```

### VPS/Cloud
```bash
git clone https://github.com/dardcor/dardcor-code.git
cd dardcor-code/app
npm install && npm run build

export JWT_SECRET="your-secure-secret"
export INITIAL_PASSWORD="your-password"
export NODE_ENV="production"

npm start
```

### Docker
```bash
docker build -t dardcor-code .
docker run -d \
  -p 3000:3000 \
  -e JWT_SECRET="your-secret" \
  -v dardcor-code-data:/app/data \
  dardcor-code
```

### Cloudflare Workers
```bash
cd dardcor-code/app
npm run deploy:cloudflare
```

**Variables de entorno:**
- `JWT_SECRET` - **¡DEBE cambiarse en producción!**
- `DATA_DIR` - Ruta de almacenamiento de la base de datos (por defecto: `~/.dardcor-code`)
- `INITIAL_PASSWORD` - Login del dashboard (por defecto: `123456`)
- `NODE_ENV` - Establece en `production` para desplegar

Consulta la [guía de despliegue](getting-started/installation.md#deployment) para detalles.

---

## ¿Mis datos están seguros?

**Sí, Dardcor Code prioriza la seguridad y privacidad:**

**Almacenamiento local:**
- Todos los datos se almacenan localmente en `~/.dardcor-code` (o `DATA_DIR` personalizado)
- No se envían datos a los servidores de Dardcor Code
- Tokens OAuth cifrados con JWT

**Sin telemetría:**
- Sin seguimiento de uso
- Sin analítica
- Sin phone-home

**Open source:**
- Código fuente completo disponible en GitHub
- Audita la seguridad tú mismo
- Revisado por la comunidad

**Mejores prácticas:**
- Cambia `JWT_SECRET` en producción
- Usa un `INITIAL_PASSWORD` fuerte
- Habilita HTTPS para despliegues en la nube
- Rota las API keys regularmente

**Lo que Dardcor Code almacena:**
- Tokens OAuth de proveedores (cifrados)
- API keys (cifradas)
- Estadísticas de uso (solo locales)
- Configuraciones de combos

**Lo que Dardcor Code NO almacena:**
- Tus prompts o respuestas
- El código que generas
- Información personal

---

## ¿Cómo actualizo Dardcor Code?

**Los métodos de actualización dependen del tipo de instalación:**

### Instalación global NPM
```bash
npm update -g dardcor-code
```

### Instalación local
```bash
cd dardcor-code/app
git pull origin main
npm install
npm run build
npm start
```

### Docker
```bash
docker pull dardcor-code:latest
docker stop dardcor-code
docker rm dardcor-code
docker run -d \
  -p 3000:3000 \
  -v dardcor-code-data:/app/data \
  dardcor-code:latest
```

**Verificar versión:**
```bash
dardcor-code --version
```

**Cambios disruptivos:**
- Revisa [CHANGELOG.md](https://github.com/dardcor/dardcor-code/blob/main/CHANGELOG.md)
- Respalda `~/.dardcor-code` antes de actualizaciones mayores
- Revisa las guías de migración para versiones mayores

---

## ¿Cómo puedo contribuir?

**¡Damos la bienvenida a las contribuciones!**

### Formas de contribuir:

1. **Reportar bugs:**
   - [GitHub Issues](https://github.com/dardcor/dardcor-code/issues)
   - Incluye logs de error, pasos para reproducir

2. **Solicitar características:**
   - [GitHub Discussions](https://github.com/dardcor/dardcor-code/discussions)
   - Describe el caso de uso y los beneficios

3. **Enviar código:**
   ```bash
   # Fork del repo
   git clone https://github.com/YOUR_USERNAME/dardcor-code.git
   cd dardcor-code
   
   # Crea una rama
   git checkout -b feature/your-feature
   
   # Haz cambios
   npm install
   npm run dev
   
   # Prueba
   npm test
   
   # Commit y push
   git add .
   git commit -m "Add your feature"
   git push origin feature/your-feature
   
   # Crea un Pull Request en GitHub
   ```

4. **Mejorar docs:**
   - Corrige errores tipográficos, agrega ejemplos
   - Traduce a otros idiomas
   - Escribe tutoriales

5. **Agregar proveedores:**
   - Implementa nuevos adaptadores de proveedores
   - Consulta `app/lib/providers/` para ejemplos

**Directrices de contribución:**
- Sigue el estilo de código existente
- Agrega tests para nuevas características
- Actualiza la documentación
- Mantén los commits atómicos y descriptivos

Consulta [CONTRIBUTING.md](https://github.com/dardcor/dardcor-code/blob/main/CONTRIBUTING.md) para detalles.

---

## ¿Necesitas más ayuda?

- **Documentación:** [dardcor-code.web.id/docs](https://dardcor-code.web.id/docs)
- **GitHub:** [github.com/dardcor/dardcor-code](https://github.com/dardcor/dardcor-code)
- **Issues:** [github.com/dardcor/dardcor-code/issues](https://github.com/dardcor/dardcor-code/issues)
- **Troubleshooting:** [troubleshooting.md](troubleshooting.md)
