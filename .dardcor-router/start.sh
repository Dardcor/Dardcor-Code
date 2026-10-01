docker stop dardcor-router
docker rm dardcor-router
docker build -t dardcor-router .
docker run -d --name dardcor-router -p 21128:21128 --env-file .env -v dardcor-router-data:/app/data dardcor-router