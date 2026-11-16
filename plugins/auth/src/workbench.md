# 论坛登录

论坛用户通过 Zitadel（OpenID Connect）登录，会话保存在 Redis 里。地址、Client ID、会话时长和管理员在“配置”里修改，保存后立即生效。

::slot[status]

## 检查登录服务

重新读取 Zitadel 的 discovery 文档和签名公钥，确认论坛能连上登录服务。不会影响正在使用的会话。

::slot[probe]

## 客户端密钥

机密客户端需要 Client Secret。密钥只存进本插件的 Vault 记录 `oidc-client-secret`，不进入配置，也不会显示出来。没有密钥时论坛只用 PKCE。

::slot[setSecret]

::slot[clearSecret]
