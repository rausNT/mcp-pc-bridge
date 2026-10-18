# Pure configuration generation. Credentials are never logged here.
import hashlib, re, secrets
BASE = '/opt/mcp-pc-bridge'
ETC = '/etc/mcp-pc-bridge'
STATE = '/var/lib/mcp-pc-bridge'

def validate_domain(domain):
    if not isinstance(domain,str) or len(domain)>253 or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',domain,re.I):
        raise ValueError('Expected an ASCII DNS name, not a URL or IP address')
    labels=domain.split('.')
    if len(labels)<2 or all(x.isdigit() for x in labels) or any(not x or len(x)>63 or x.startswith('-') or x.endswith('-') for x in labels):
        raise ValueError('Expected a valid DNS name')
    return domain.lower()

def generate(domain, device_id='desktop'):
    domain=validate_domain(domain)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}',device_id):
        raise ValueError('Invalid device id')
    device_token=secrets.token_hex(32);mcp_token=secrets.token_hex(32)
    client_id='dc-'+secrets.token_hex(16)
    client_secret=secrets.token_urlsafe(32);password=secrets.token_urlsafe(32)
    digest=lambda x:hashlib.sha256(x.encode()).hexdigest()
    relay='HOST=127.0.0.1\nPORT=8787\nDEVICE_ID='+device_id+'\nCALL_TIMEOUT_MS=120000\nDEVICE_TOKEN='+device_token+'\nMCP_TOKEN='+mcp_token+'\n'
    gateway={'issuer':'https://'+domain,'resource':'https://'+domain+'/mcp','upstream':'http://127.0.0.1:8787/mcp',
      'mcpToken':mcp_token,'clientId':client_id,'clientSecretHash':digest(client_secret),'ownerPasswordHash':digest(password),
      'redirectUris':['https://chatgpt.com/connector_platform_oauth_redirect'],'tlsDir':ETC+'/tls/current','stateFile':STATE+'/gateway/tokens.json'}
    owner={'clientId':client_id,'clientSecret':client_secret,'ownerPassword':password,'deviceToken':device_token,'deviceId':device_id,'mcpUrl':gateway['resource']}
    return relay,gateway,owner
