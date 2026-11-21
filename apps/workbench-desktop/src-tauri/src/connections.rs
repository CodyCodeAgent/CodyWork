use reqwest::{redirect, Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::{fs, io, net::IpAddr, path::Path, time::Duration};
use url::{Host, Url};

#[derive(Clone, Deserialize, Serialize)]
pub struct Server {
    pub name: String,
    pub address: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Connections {
    pub servers: Vec<Server>,
    pub default_address: Option<String>,
}

impl Connections {
    pub fn read(path: &Path) -> Result<Self, String> {
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "无法读取服务器配置。".into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(_) => Err("无法读取服务器配置。".into()),
        }
    }

    pub fn write(&self, path: &Path) -> Result<(), String> {
        let directory = path.parent().ok_or("服务器配置路径不可用。")?;
        let result = (|| -> io::Result<()> {
            fs::create_dir_all(directory)?;
            let mut file = tempfile::NamedTempFile::new_in(directory)?;
            serde_json::to_writer_pretty(&mut file, self)?;
            file.as_file().sync_all()?;
            file.persist(path).map_err(|error| error.error)?;
            Ok(())
        })();
        result.map_err(|_| "无法保存服务器配置。".into())
    }

    pub fn server(&self, address: &str) -> Result<&Server, String> {
        self.servers
            .iter()
            .find(|server| server.address == address)
            .ok_or_else(|| "这条连接已移除，请重新选择。".into())
    }

    pub fn save(&mut self, previous: Option<&str>, server: Server) -> Result<(), String> {
        if self
            .servers
            .iter()
            .any(|item| item.address == server.address && previous != Some(item.address.as_str()))
        {
            return Err("这个服务器地址已保存。".into());
        }
        if let Some(previous) = previous {
            let item = self
                .servers
                .iter_mut()
                .find(|item| item.address == previous)
                .ok_or("这条连接已移除，请重新添加。")?;
            if self.default_address.as_deref() == Some(previous) {
                self.default_address = Some(server.address.clone());
            }
            *item = server;
        } else {
            self.servers.push(server);
        }
        Ok(())
    }
}

pub fn http_url(raw: &str) -> Result<Url, String> {
    let error = "请输入完整的 HTTP 或 HTTPS 地址，例如 https://codywork.example.com。";
    let url = Url::parse(raw.trim()).map_err(|_| error)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(error.into());
    }
    Ok(url)
}

pub fn server_url(raw: &str) -> Result<Url, String> {
    let url = http_url(raw)?;
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err("请填写服务器根地址，可带端口。".into());
    }
    if url.scheme() == "http" && !local_host(&url) {
        return Err("公网服务器请使用 HTTPS。内网 HTTP 可填写私有 IP 或 .local 地址。".into());
    }
    Ok(url)
}

fn local_host(url: &Url) -> bool {
    match url.host() {
        Some(Host::Ipv4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Some(Host::Ipv6(ip)) => {
            ip.is_loopback()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.to_ipv4_mapped().is_some_and(|ip| {
                    let host = IpAddr::V4(ip);
                    host.is_loopback() || ip.is_private() || ip.is_link_local()
                })
        }
        Some(Host::Domain(host)) => host == "localhost" || host.ends_with(".local"),
        None => false,
    }
}

#[derive(Deserialize)]
struct Health {
    ok: bool,
    data: Option<HealthData>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct HealthData {
    service: String,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionCheck {
    pub requires_login: bool,
}

pub fn client() -> Result<Client, reqwest::Error> {
    Client::builder()
        .timeout(Duration::from_secs(6))
        .redirect(redirect::Policy::none())
        .build()
}

pub async fn check(client: &Client, url: &Url) -> Result<ConnectionCheck, String> {
    let endpoint = url.join("api/health").expect("validated HTTP(S) origin");
    let response = client.get(endpoint).send().await.map_err(|error| {
        if error.is_timeout() {
            "连接超时。请确认服务器可访问，然后重试。"
        } else {
            "无法连接服务器。请确认地址、网络与证书。"
        }
    })?;
    let status = response.status();
    let invalid = || format!("CodyWork 健康检查未通过（HTTP {}）。", status.as_u16());
    let body = read_limited(response, 8192).await.ok_or_else(invalid)?;
    let health: Health = serde_json::from_slice(&body).map_err(|_| invalid())?;
    if status == StatusCode::OK
        && health.ok
        && health
            .data
            .is_some_and(|data| data.service == "codywork" && data.status == "ok")
    {
        return Ok(ConnectionCheck {
            requires_login: false,
        });
    }
    if status == StatusCode::UNAUTHORIZED
        && !health.ok
        && health.error.as_deref() == Some("authentication required")
    {
        // CodyWork gates /api/health outside loopback. Verify its login form
        // before treating an unauthenticated JSON response as a CodyWork host.
        let login = client
            .get(url.join("auth/login").expect("validated HTTP(S) origin"))
            .send()
            .await
            .map_err(|_| invalid())?;
        if login.status() == StatusCode::OK
            && read_limited(login, 256 * 1024).await.is_some_and(|body| {
                let html = String::from_utf8_lossy(&body);
                html.contains("<title>CodyWork 登录</title>")
                    && html.contains("action=\"/api/auth/login\"")
            })
        {
            return Ok(ConnectionCheck {
                requires_login: true,
            });
        }
    }
    Err(invalid())
}

async fn read_limited(mut response: Response, limit: usize) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len() + chunk.len() > limit {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    Some(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_origins_and_limits_cleartext_to_local_addresses() {
        for (input, expected) in [
            ("https://CODYWORK.example:443", "https://codywork.example/"),
            ("http://10.37.222.12:3001", "http://10.37.222.12:3001/"),
            ("http://[fd00::1]:3001", "http://[fd00::1]:3001/"),
            ("http://localhost:3210", "http://localhost:3210/"),
        ] {
            assert_eq!(server_url(input).unwrap().as_str(), expected);
        }
        for input in [
            "file:///tmp/secret",
            "http://codywork.example",
            "https://a@server",
            "https://server/demand",
            "https://server/?invite=123",
            "https://server/#session",
        ] {
            assert!(server_url(input).is_err(), "{input}");
        }
    }

    #[test]
    fn stores_one_profile_per_origin_and_updates_default_on_edit() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let mut settings = Connections::read(&path).unwrap();
        let server = Server {
            name: "CN".into(),
            address: "http://127.0.0.1:1/".into(),
        };
        settings.save(None, server.clone()).unwrap();
        assert!(settings.save(None, server.clone()).is_err());
        settings.default_address = Some(server.address.clone());
        let updated = Server {
            name: "CN 2".into(),
            address: "https://test.example/".into(),
        };
        settings
            .save(Some(&server.address), updated.clone())
            .unwrap();
        settings.write(&path).unwrap();
        let restored = Connections::read(&path).unwrap();
        assert_eq!(
            restored.default_address.as_deref(),
            Some(updated.address.as_str())
        );
        assert_eq!(
            restored.server(&updated.address).unwrap().name,
            updated.name
        );
    }
}
