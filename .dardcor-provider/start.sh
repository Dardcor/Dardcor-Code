docker stop dardcor-provider 2>/dev/null || true
docker rm dardcor-provider 2>/dev/null || true
docker build -t dardcor-provider .
docker run -d --name dardcor-provider -p 25000:25000 --env-file .env -v dardcor-data:/app/data dardcor-provider