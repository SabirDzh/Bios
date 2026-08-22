Auth 

POST api/v1/auth/register - регистрация пользователя оп паролю и почте
POST api/v1/auth/login - вход пользователя по почте и отп коду
POST api/v1/auth/refresh - обновление токена 
POST api/v1/auth/access - обновление access токена 
POST api/v1/auth/revoke - отмена сессии 
GET api/v1/auth/me - текущий пользователь 
POST api/v1/auth/email-verify - отправка отп на почту, для подтверждения входа 

Workspaces

POST api/v1/workspaces - создание рабочего пространства 
GET api/v1/workspaces - список рабочих пространств 
GET api/v1/workspaces/:workspace_id - получение рабочего пространства 
PATCH api/v1/workspaces/:workspace_id - обновление рабочего пространства 
DELETE api/v1/workspaces/:workspace_id - удаление рабочего пространства 
POST api/v1/workspaces/:workspace_id/invitations - добавление пользователя в рабочее пространство 
GET api/v1/workspaces/:workspace_id/activity - список активностей в рабочем пространстве 
PATCH api/v1/workspaces/:workspace_id/settings - настройки рабочего пространства  
GET api/v1/workspaces/:workspace_id/members - получение списка пользователей 
GET api/v1/workspaces/:workspace_id/invitations - получение списка активных приглошений
DELETE api/v1/workspaces/:workspace_id/invitations/:invitations_id - отозвать приглошение 
POST api/v1/workspaces/:workspace_id/accept - принятие приглашения
DELETE api/v1/workspaces/:workspace_id/member/:member_id - удалить участника 
PATCH api/v1/workspaces/:workspace_id/member/:member_id - изменить роль участника 
GET api/v1/workspaces/:workspace_id/projects - получить все проекты рабочего пространства 
POST api/v1/workspaces/:workspace_id/projects - создать проект в рабочем пространстве 
GET api/v1/worksapces/:worksapce_id/projects/:project_id - получить проект рабочего пространства 
PATCH api/v1/workspaces/:workspace_id/projects/:project_id - обновить проект в рабочем пространстве 
DELETE api/v1/workspaces/:workspace_id/projects/:project_id - удалить проект из рабочего пространства 
GET api/v1/workspaces/:workspace_id/servers - получить список серверов рабочего пространства 
POST api/v1/workspaces/:workspace_id/servers - создать сервер в рабочем пространстве 
GET api/v1/workspaces/:workspace_id/servers/:server_id - получить сервер 
PATCH api/v1/workspaces/:workspace_id/servers/:server_id - изменить сервер 
DELETE api/v1/workspaces/:workspace_id/servers/:server_id - удалить сервер 
POST api/v1/workspaces/:workspace_id/servers/:server_id/test - проверить ssh-подключение 
POST api/v1/workspaces/:workspace_id/servers/:server_id/agent/install - установить агента на сервер 
GET api/v1/workspaces/:workspace_id/servers/:server_id/agent - просмотреть информацию о агенте 
POST api/v1/workspaces/:workspace_id/servers/:server_id/agent/upgrade - обновить агента 
DELETE api/v1/workspaces/:workspace_id/servers/:server_id/agent - удалить агента 
GET api/v1/workspaces/:workspace_id/servers/:server_id/connections - получить историю подключений  
GET api/v1/workspaces/:workspace_id/servers/:server_id/docker/containers - получить список контейнеров 
GET api/v1/workspaces/:workspace_id/servers/:server_id/docker/containers/:container_id - получить подробную информацию о контейнере 
PATCH api/v1/workspaces/:workspace_id/servers/:server_id/docker/containers/:container_id - настраивать контейнер и перезапускать 
DELETE api/v1/workspaces/:workspace_id/servers/:server_id/docker/containers/:container_id - удалить контейнер 
GET api/v1/workspaces/:workspace_id/servers/:server_id/docker/containers/:container_id/logs - просмотреть логи контейнера 
GET api/v1/workspaces/:workspace_id/servers/:server_id/docker/containers/:container_id/env - получить переменные окружения 
GET api/v1/workspaces/:workspace_id/servers/:server_id/docker/containers/:container_id/stats - получить статистику использования 
GET api/v1/workspaces/:workspace_id/servers/:server_id/docker/containers/:container_id/history - история контейнера 
POST api/v1/workspaces/:workspace_id/servers/:server_id/docker/containers/:container_id/exec - открыть shell 
PUT api/v1/workspaces/:workspace_id/servers/:server_id/docker/containers/:container_id/resources - ограничить ресурсы 
GET api/v1/workspaces/:workspace_id/servers/:server_id/docker/events - поток событий docker 
GET api/v1/workspace/:workspace_id/servers/:server_id/docker/volumes - список томов 
POST api/v1/workspace/:workspace_id/servers/:server_id/docker/volumes - создать том 
GET api/v1/workspace/:workspace_id/servers/:server_id/docker/volumes/:volume_name - информация о томе 
DELETE api/v1/workspace/:workspace_id/servers/:server_id/docker/volumes/:volume_name - удалить том 
GET api/v1/workspace/:workspace_id/servers/:server_id/docker/networks - список сетей 
POST api/v1/workspace/:workspace_id/servers/:server_id/docker/networks - создать сеть 
GET api/v1/workspace/:workspace_id/servers/:server_id/docker/networks/:network_id - получить информацию о сети 
DELETE api/v1/workspace/:workspace_id/servers/:server_id/docker/networks/:network_id - удалить сеть 
GET api/v1/workspaces/:workspace_id/servers/:server_id/docker/images - список образов 
GET api/v1/workspaces/:workspace_id/servers/:server_id/docker/images/:image_id - получение подробной информации образа 
POST api/v1/workspaces/:workspace_id/servers/:server_id/docker/images/pull - скачать образ 
POST api/v1/workspaces/:workspace_id/servers/:server_id/docker/images/build - собрать образ 
DELETE api/v1/workspaces/:workspace_id/servers/:server_id/docker/images/:image_id - удалить образ 
POST api/v1/workspaces/:workspace_id/servers/:server_id/docker/images/:image_id/export - экспорт образа 
POST api/v1/workspaces/:workspace_id/servers/:server_id/docker/images/import - импорт образа 
GET api/v1/workspaces/:workspace_id/servers/:server_id/docker/images/:image_id/containers - контейнеры, созданные из образа
GET api/v1/workspaces/:workspace_id/servers/:server_id/compose/projects - список компос-проектов 
POST api/v1/workspaces/:workspace_id/servers/:server_id/compose/projects - импортировать компос-проект 
GET api/v1/workspaces/:workspace_id/servers/:server_id/compose/projects/:project_id - детали проекта 
PUT api/v1/workspaces/:workspace_id/servers/:server_id/compose/projects/:porject_id - обновить манифест 
DELETE api/v1/workspaces/:workspace_id/servers/:server_id/compose/projects/:project_id - удалить проект 
PATCH api/v1/workspaces/:workspace_id/servers/:server_id/compose/projects/:project_id - изменять статус проектов 
GET api/v1/workspaces/:workspace_id/servers/:server_id/compose/projects/:project_id/services - состояние сервисов проекта 
GET api/v1/workspaces/:workspace_id/servers/:server_id/compose/projects/:project_id/logs - логи проекта
GET api/v1/workspaces/:workspace_id/git/integrations - подключенные гит-провайдеры 
POST api/v1/workspaces/:workspace_id/git/integrations - подключить гит-провайдера 
DELETE api/v1/workspaces/:workspace_id/git/integrations/:integration_id - удалить провайдера 
GET api/v1/workspaces/:workspace_id/git/repositories - список репозиториев провайдера 
POST api/v1/workspaces/:workspace_id/git/repositories - подключить репозиторий к ICC 
DELETE api/v1/workspaces/:workspace_id/git/repositories/:repo_id - отключить репозиторий 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/branches - получить ветки репозитория
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/commits - получить историю коммитов 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/commits/:sha - получить конкретный коммит и информацию о нем 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/pulls - все пул-реквесты 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/pulls/:pull_id - получить информацию о конкретном пул-реквесте 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/pulls/:pull_id/diff - получить изменения в этом пул-реквесте 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/issues - все issues 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/issues/:issue_id - получить информацию конкретного issue 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/releases - получить список всех релизов 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/tags - получить список всех тегов 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/files - получить список всех файлов 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/tree - получить содержимое директории
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/compare - сравнение веток 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/actions/workflows - получить список workflows 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/actions/workflows/:workflow_id - получить конкретный workflow 
POST api/v1/workspaces/:workspace_id/git/repositories/:repo_id/actions/workflows/:workflow_id/dispatch - ручной запуск 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/actions/runs - история запусков 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/actions/runs/:run_id - детали запуска 
PATCH api/v1/workspaces/:workspace_id/git/repositories/:repo_id/actions/runs/:run_id - повторный запуск / отмена выполнения 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/jobs - jobs запуска 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/jobs/:job_id/logs - получить jobs запуска логи 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/artifacts - артефакты запуск 
GET api/v1/workspaces/:workspace_id/git/repositories/:repo_id/artifacts/:artifact_id/download - скачать артефакт 
GET api/v1/workspaces/:workspace_id/deployments - история деплоев 
POST api/v1/workspaces/:workspace_id/deployments - ручной деплой 
GET api/v1/workspaces/:workspace_id/projects/:project_id/deploy-configs - конфигурация деплоя проекта 
POST api/v1/workspaces/:workspace_id/projects/:project_id/deploy-configs - создать конфигурацию 
GET api/v1/workspaces/:workspace_id/projects/:project_id/deploy-configs/config_id - детали конфигурации 
PATCH api/v1/workspaces/:workspace_id/projects/:project_id/deploy-configs/config_id - обновить конфигурацию 
DELETE api/v1/workspaces/:workspace_id/projects/:project_id/deploy-configs/config_id - удалить конфигурацию 
POST api/v1/workspaces/:workspace_id/projects/:project_id/deploy-configs/:config_id/schedules - добавить расписание автодеплоя 
GET api/v1/workspaces/:workspace_id/projects/:project_id/deploy-configs/:config_id/schedules - получить список расписаний 
DELETE api/v1/workspaces/:workspace_id/projects/:project_id/deploy-configs/:config_id/schedules/:schedule_id - удалить расписание 
GET api/v1/workspaces/:workspace_id/projects/:project_id/deploy-configs/:config_id/history - история деплоев конфигурации


Deployments 
GET api/v1/deployments/:deployment_id - детали деплоя 
GET api/v1/deployments/:deployment_id/logs - логи деплоя 

Users 

GET api/v1/users/me 
PATCH api/v1/users/me
PATCH api/v1/users/me/password
DELETE api/v1/users/me
