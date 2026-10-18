//! Search Console through a Google service account (advanced option): its key signs a short-lived
//! JWT (RS256) that Google exchanges for an access token. No browser, no refresh token.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};

use super::oauth::{self, SCOPES, Tokens};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ServiceAccount {
    pub client_email: String,
    /// PKCS#8 PEM, as in the key file.
    pub private_key: String,
}

/// Debug output never shows the private key.
impl std::fmt::Debug for ServiceAccount {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ServiceAccount")
            .field("client_email", &self.client_email)
            .field("private_key", &"[redacted]")
            .finish()
    }
}

impl ServiceAccount {
    pub fn from_json(json: &str) -> Result<Self, String> {
        let v: serde_json::Value = serde_json::from_str(json)
            .map_err(|_| "File del service account non valido: non è JSON".to_string())?;
        if v["type"] != "service_account" {
            return Err(
                "Il file non è la chiave di un service account Google (type: service_account)"
                    .into(),
            );
        }
        let field = |k: &str| v[k].as_str().filter(|s| !s.is_empty()).map(str::to_owned);
        let sa = ServiceAccount {
            client_email: field("client_email")
                .ok_or("File del service account senza client_email")?,
            private_key: field("private_key")
                .ok_or("File del service account senza private_key")?,
        };
        // fail now, not at the first request, if the key can't sign
        signer(&sa.private_key)?;
        Ok(sa)
    }
}

fn signer(pem: &str) -> Result<aws_lc_rs::signature::RsaKeyPair, String> {
    let body: String = pem.lines().filter(|l| !l.starts_with("-----")).collect();
    let der = STANDARD
        .decode(body.trim())
        .map_err(|_| "Chiave privata del service account non leggibile".to_string())?;
    aws_lc_rs::signature::RsaKeyPair::from_pkcs8(&der)
        .map_err(|_| "Chiave privata del service account non valida (serve RSA PKCS#8)".to_string())
}

/// The signed assertion: valid for 10 minutes, for read-only Search Console.
pub fn assertion(sa: &ServiceAccount, now: u64) -> Result<String, String> {
    let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"RS256","typ":"JWT"}"#);
    let claims = URL_SAFE_NO_PAD.encode(
        serde_json::json!({
            "iss": sa.client_email,
            "scope": SCOPES.split(' ').next().expect("first scope is Search Console"),
            "aud": oauth::TOKEN_URL,
            "iat": now,
            "exp": now + 600,
        })
        .to_string(),
    );
    let message = format!("{header}.{claims}");
    let key = signer(&sa.private_key)?;
    let mut sig = vec![0u8; key.public_modulus_len()];
    key.sign(
        &aws_lc_rs::signature::RSA_PKCS1_SHA256,
        &aws_lc_rs::rand::SystemRandom::new(),
        message.as_bytes(),
        &mut sig,
    )
    .map_err(|_| "Firma con la chiave del service account non riuscita".to_string())?;
    Ok(format!("{message}.{}", URL_SAFE_NO_PAD.encode(sig)))
}

pub async fn token(sa: &ServiceAccount) -> Result<Tokens, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let jwt = assertion(sa, now)?;
    oauth::token_request(&[
        ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
        ("assertion", &jwt),
    ])
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use aws_lc_rs::encoding::AsDer;
    use aws_lc_rs::signature::{KeyPair, RsaKeyPair};

    /// A throwaway key made for the test, so no private key ever sits in the repository.
    fn test_key() -> (String, Vec<u8>) {
        let key = RsaKeyPair::generate(aws_lc_rs::rsa::KeySize::Rsa2048).unwrap();
        let der = key.as_der().unwrap();
        let pem = format!(
            "-----BEGIN PRIVATE KEY-----\n{}\n-----END PRIVATE KEY-----\n",
            STANDARD.encode(der.as_ref())
        );
        (pem, key.public_key().as_ref().to_vec())
    }

    #[test]
    fn signs_a_jwt_google_can_verify() {
        let (pem, public) = test_key();
        let json = serde_json::json!({"type": "service_account", "client_email": "cf@p.iam.gserviceaccount.com", "private_key": pem}).to_string();
        let sa = ServiceAccount::from_json(&json).unwrap();
        let jwt = assertion(&sa, 1_000).unwrap();
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3);
        let claims: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["iss"], "cf@p.iam.gserviceaccount.com");
        assert_eq!(
            claims["scope"],
            "https://www.googleapis.com/auth/webmasters.readonly"
        );
        assert_eq!(
            (claims["iat"].as_u64(), claims["exp"].as_u64()),
            (Some(1_000), Some(1_600))
        );
        let signed = format!("{}.{}", parts[0], parts[1]);
        aws_lc_rs::signature::UnparsedPublicKey::new(
            &aws_lc_rs::signature::RSA_PKCS1_2048_8192_SHA256,
            public,
        )
        .verify(
            signed.as_bytes(),
            &URL_SAFE_NO_PAD.decode(parts[2]).unwrap(),
        )
        .expect("signature verifies with the public key");
    }

    #[test]
    fn debug_output_hides_the_key() {
        let sa = ServiceAccount {
            client_email: "a@b".into(),
            private_key: "SECRET".into(),
        };
        assert!(!format!("{sa:?}").contains("SECRET"));
    }

    #[test]
    fn rejects_files_that_are_not_service_account_keys() {
        assert!(
            ServiceAccount::from_json(r#"{"installed":{}}"#)
                .unwrap_err()
                .contains("service_account")
        );
        let bad = r#"{"type":"service_account","client_email":"a@b","private_key":"-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----"}"#;
        assert!(ServiceAccount::from_json(bad).is_err());
    }
}
