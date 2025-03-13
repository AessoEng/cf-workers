export default {
  async fetch(request, env) {
    try {
      // Configuration - Customizable per site
      const message = "This website is not available in your country.";
      
      // Bypass settings
      const bypassCookieName = "bypassCookie";
      const bypassCookieValue = "qZF41KubXTD2JJ4EGSmw"; 
      const bypassCookieExpiration = 60 * 60 * 24 * 30; // 30 days
      
      // Bypass subdomains
      const bypassSubs = ["stg"];
      
      // Country mapping - country code: subdomain (empty for default domain)
      const countryMap = {
        US: "",
        GU: "",
        PR: ""
      };
      
      // Language overrides - [country, language]: subdomain
      //const languageOverrides = {
      //  "US-es": "es-us",
      //  "BE-de": "de-be"
      //};
      
      // Using empty object for now
      const languageOverrides = {};

      // Check required KV namespaces
      if (!env.GLOBAL_ALLOWED_EMAILS || !env.SITE_ALLOWED_EMAILS || !env.AUTH_TOKENS) {
        console.error("Missing required KV namespace bindings.");
        return fetch(request);
      }

      const url = new URL(request.url);
      const method = request.method;
      const hostname = request.headers.get("Host") || url.hostname;
      
      // Handle email auth form submission
      if (url.pathname === '/auth-request' && method === 'POST') {
        try {
          const formData = await request.formData();
          const email = formData.get('email')?.toString().toLowerCase().trim();
          
          if (!email || !email.includes('@')) {
            return new Response('Please provide a valid email address', { status: 400 });
          }
          
          const isAllowed = await isEmailAllowed(email, env, hostname);
          console.log(`Email auth request: ${email}, Allowed: ${isAllowed}, Hostname: ${hostname}`);
          
          // Always generate token for security (even if not allowed)
          const token = crypto.randomUUID();
          const expiration = Date.now() + (15 * 60 * 1000); // 15 minutes
          
          if (isAllowed) {
            await env.AUTH_TOKENS.put(token, JSON.stringify({
              email,
              expiration,
              site: hostname
            }), { expirationTtl: 900 });
            
            const origin = url.origin;
            const authLink = `${origin}/auth-verify?token=${token}`;
            
            // Send email if API key is available
            if (env.RESEND_API_KEY) {
              try {
                const htmlContent = generateEmailHtml(hostname, authLink);
                const textContent = `
Hello,

Click the link below to access the website:

${authLink}

This link will expire in 15 minutes.

If you did not request this link, please ignore this email.`;
                
                // Always use jumohealth.com domain and no-reply@jumohealth.com
                const fromAddress = 'no-reply@jumohealth.com';
                
                const sendResponse = await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${env.RESEND_API_KEY}`
                  },
                  body: JSON.stringify({
                    from: fromAddress,
                    to: email,
                    subject: `Your ${hostname} Website Access Link`,
                    html: htmlContent,
                    text: textContent
                  })
                });
                
                const responseData = await sendResponse.json();
                
                if (!sendResponse.ok) {
                  console.error('Resend API error:', responseData);
                  throw new Error(`Failed to send email: ${JSON.stringify(responseData)}`);
                }
              } catch (emailError) {
                console.error('Error sending email:', emailError);
              }
            } else {
              console.error('RESEND_API_KEY not configured, unable to send email');
            }
          }
          
          // Always show same confirmation page (whether allowed or not)
          return new Response(emailSentTemplate, {
            headers: { 'Content-Type': 'text/html' }
          });
        } catch (error) {
          console.error(`Auth request error: ${error}`);
          return new Response(`Error: ${error.message}`, { status: 500 });
        }
      }
      
      // Handle auth verification
      if (url.pathname === '/auth-verify') {
        try {
          const token = url.searchParams.get('token');
          
          if (!token) {
            return new Response('Invalid token', { status: 400 });
          }
          
          const tokenData = await env.AUTH_TOKENS.get(token);
          
          if (!tokenData) {
            return new Response('Token expired or invalid', { status: 400 });
          }
          
          const { email, expiration, site } = JSON.parse(tokenData);
          
          if (Date.now() > expiration) {
            await env.AUTH_TOKENS.delete(token);
            return new Response('Token expired', { status: 400 });
          }
          
          if (site !== hostname) {
            return new Response('Invalid token for this site', { status: 400 });
          }
          
          // Set bypass cookie and redirect to homepage
          const headers = new Headers();
          headers.set('Location', url.origin);
          headers.append('Set-Cookie', 
            `${bypassCookieName}=${bypassCookieValue}; `+
            `Max-Age=${bypassCookieExpiration}; `+
            `Path=/; `+
            `Secure; `+
            `HttpOnly; SameSite=Lax`
          );
          
          await env.AUTH_TOKENS.delete(token);
          
          return new Response(null, {
            status: 302,
            headers
          });
        } catch (error) {
          console.error(`Token verification error: ${error}`);
          return new Response(`Error verifying token: ${error.message}`, { status: 400 });
        }
      }
      
      // Geofencing logic
      const hostHeader = request.headers.get("Host");
      const country = request.cf && request.cf.country ? request.cf.country : null;
      const acceptLanguage = request.headers.get('Accept-Language') || request.headers.get('accept-language') || '';
      const lang = acceptLanguage.substring(0,2) || '';
      const urlObj = new URL(request.url);
      const domainParts = hostHeader.split('.');
      
      // Check bypass conditions
      if (bypassSubs.indexOf(domainParts[0]) >= 0) {
        return fetch(request);
      }
      
      const cookies = getCookies(request);
      if (cookies[bypassCookieName]) {
        return fetch(request);
      }
      
      // Block unauthorized countries
      if (countryMap[country] === undefined) {
        let modifiedHeaders = new Headers();
        modifiedHeaders.set('Content-Type', 'text/html');
        modifiedHeaders.append('Pragma', 'no-cache');
        modifiedHeaders.append('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        
        let page = blockedPageTemplate.replace("{{ message }}", message);
        
        return new Response(page, {
          status: 401,
          headers: modifiedHeaders
        });
      }    

      // Check if already on correct domain
      if (domainParts[0].slice(-2) == countryMap[country].slice(-2)) {
        return fetch(request);
      }

      if (domainParts[0].slice(-2) == 'us' && country == 'US') {
        return fetch(request);
      }

      if (domainParts.length == 2 && countryMap[country] === "") {
        return fetch(request);
      }

      // Handle country-specific redirects
      if (country != null && country in countryMap) {
        var subdomain = countryMap[country];
        
        // Apply language override if applicable
        const languageKey = `${country}-${lang}`;
        if (languageOverrides[languageKey]) {
          subdomain = languageOverrides[languageKey];
        }

        urlObj.hostname = [subdomain, domainParts[domainParts.length - 2], domainParts[domainParts.length - 1]].filter(Boolean).join('.');
        
        const redirectHeaders = new Headers();
        redirectHeaders.set('Location', urlObj.toString());
        
        return new Response(null, {
          status: 302,
          headers: redirectHeaders
        });
      
      } else if (domainParts.length == 3) {
        // Redirect to root domain for unlisted countries
        urlObj.hostname = [domainParts[domainParts.length - 2], domainParts[domainParts.length - 1]].join('.');
        
        const redirectHeaders = new Headers();
        redirectHeaders.set('Location', urlObj.toString());
        
        return new Response(null, {
          status: 302,
          headers: redirectHeaders
        });
      } else {
        return fetch(request);
      }
    } catch (error) {
      console.error(`Worker error: ${error.message}`);
      return fetch(request);
    }
  },
};

// Helper function to check if email is allowed
async function isEmailAllowed(email, env, hostname) {
  try {
    const domain = '@' + email.split('@')[1];

    // Check global allowed emails first
    const isGloballyAllowed = await env.GLOBAL_ALLOWED_EMAILS.get(domain);
    if (isGloballyAllowed === "1") return true;

    // Check site-specific allowed emails
    const exactSiteMatch = await env.SITE_ALLOWED_EMAILS.get(`${hostname}:${email}`);
    if (exactSiteMatch === "1") return true;
    
    const domainSiteMatch = await env.SITE_ALLOWED_EMAILS.get(`${hostname}:${domain}`);
    return domainSiteMatch === "1";
  } catch (error) {
    console.error(`Error checking allowed emails: ${error}`);
    return false;
  }
}

function getCookies(request) {
  let cookies = {};
  try {
    const cookieString = request.headers.get('Cookie');
    if (cookieString) {
      cookieString.split(';').forEach(cookie => {
        try {
          const parts = cookie.split('=');
          if (parts.length >= 2) {
            cookies[parts[0].trim()] = parts[1];
          }
        } catch (error) {
          console.error(`Error parsing individual cookie: ${error.message}`);
        }
      });
    }
  } catch (error) {
    console.error(`Error parsing cookies: ${error.message}`);
  }
  return cookies;
}

// Generate HTML email content
function generateEmailHtml(siteName, authLink) {
  return `
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <style>
    :root {
      color-scheme: light dark;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      width: 100%;
      background: #fff;
      color: #333;
    }
    
    .email-container {
      padding: 88px 32px;
      max-width: 600px;
      margin: 0 auto;
      box-sizing: border-box;
    }
    
    h2 {
      font-size: 32px;
      margin: 0 0 24px;
      font-weight: 500;
      line-height: 1.3;
    }
    
    p {
      font-size: 16px;
      color: #666;
      margin-bottom: 16px;
      line-height: 1.6;
    }
    
    .button-container {
      text-align: center;
      margin: 32px 0;
    }
    
    .button {
      display: inline-block;
      background: #333;
      color: #fff !important;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 4px;
      font-size: 16px;
      font-weight: 500;
      text-align: center;
    }
    
    .link-box {
      margin: 16px 0;
      word-break: break-all;
    }
    
    .link-box a {
      color: #333;
      text-decoration: underline;
    }
    
    .footer {
      margin-top: 32px;
      padding-top: 32px;
      border-top: 1px solid #e0e0e0;
      color: #666;
      font-size: 14px;
    }
    
    @media (prefers-color-scheme: dark) {
      body {
        background: #111;
        color: #fff;
      }
      
      .button {
        background: #fff;
        color: #111 !important;
      }
      
      .link-box a {
        color: #fff;
      }
      
      .footer {
        border-color: #333;
      }
    }
    
    @media only screen and (max-width: 600px) {
      .email-container {
        padding: 64px 24px;
      }
      
      h2 {
        font-size: 28px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <h2>${siteName} Website Access</h2>
    <p>Hello, please click the button below to access the ${siteName} website.</p>
    
    <div class="button-container">
      <a href="${authLink}" class="button">Access Website</a>
    </div>
    
    <p>Or copy and paste this link into your browser:</p>
    <div class="link-box">
      <a href="${authLink}">${authLink}</a>
    </div>
    
    <p>Please note that this link will expire in 15 minutes.</p>
    
    <div class="footer">If you did not request this link, please ignore this email.</div>
  </div>
</body>
</html>`;
}

// Template for the blocked page with auth form
const blockedPageTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access Restricted</title>
  <link href='https://fonts.googleapis.com/css?family=Open+Sans:500,400' rel='stylesheet'>
  <style>
    body {
      font-family: "Open Sans", sans-serif;
      margin: 0;
      padding: 0;
      min-height: 100vh;
      display: flex;
      background: white;
      text-align: center;
    }
    
    .message {
      font-size: 40px;
      color: #333;
      max-width: 80%;
      line-height: 1.5;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }
    
    .access-btn {
      background: none;
      color: #666;
      border: none;
      font: inherit;
      font-size: 14px;
      cursor: pointer;
      position: fixed;
      bottom: 40px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
    }
    
    .access-btn:hover {
      color: #333;
    }
    
    .form-container {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }
    
    .form-box {
      background: white;
      padding: 88px;
      border-radius: 8px;
      width: 90%;
      max-width: 600px;
      position: relative;
    }
    
    .form-title {
      font-size: 32px;
      color: #333;
      margin-bottom: 24px;
    }
    
    .form-subtitle {
      font-size: 16px;
      color: #666;
      margin-bottom: 32px;
      line-height: 1.6;
    }
    
    input[type="email"] {
      width: 100%;
      padding: 16px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 16px;
      margin-bottom: 24px;
      box-sizing: border-box;
    }
    
    .submit-btn {
      width: 100%;
      background: #333;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 16px 24px;
      font-size: 16px;
      cursor: pointer;
    }
    
    .close-btn {
      position: absolute;
      top: 16px;
      right: 16px;
      font-size: 24px;
      cursor: pointer;
      color: #777;
    }
  </style>
</head>
<body>
  <div class="message">{{ message }}</div>
  
  <button class="access-btn" onclick="showForm()">Need help?</button>
  
  <div class="form-container" id="formContainer" onclick="handleContainerClick(event)">
    <div class="form-box">
      <span class="close-btn" onclick="hideForm()">&times;</span>
      <div class="form-title">Having access issues?</div>
      <div class="form-subtitle">There are several potential reasons for website access issues, such as corporate VPNs, revolving IP addresses, and browser/network caching. If you're having trouble, <u>enter your company email below</u> for a unique access link.<br><br>The access link will grant you <u>30-days of access</u> on this device and browser. You'll only receive the link if you provide an approved company email domain associated with this website.</div>
      <form action="/auth-request" method="POST">
        <input type="email" name="email" required placeholder="your@email.com">
        <button class="submit-btn" type="submit">Send</button>
      </form>
    </div>
  </div>

  <script>
    function showForm() {
      document.getElementById('formContainer').style.display = 'flex';
    }
    
    function hideForm() {
      document.getElementById('formContainer').style.display = 'none';
    }

    function handleContainerClick(event) {
      if (event.target.id === 'formContainer') {
        hideForm();
      }
    }
  </script>
</body>
</html>`;

// Email sent confirmation page
const emailSentTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access Link Sent</title>
  <link href='https://fonts.googleapis.com/css?family=Open+Sans:500,400' rel='stylesheet'>
  <style>
    body {
      font-family: "Open Sans", sans-serif;
      margin: 0;
      padding: 0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      background: white;
      text-align: center;
    }
    
    .container {
      width: 90%;
      max-width: 600px;
      padding: 88px;
    }
    
    .icon {
      font-size: 48px;
      margin-bottom: 32px;
    }
    
    h1 {
      font-size: 32px;
      color: #333;
      margin: 0 0 24px;
      font-weight: 500;
    }
    
    p {
      font-size: 16px;
      color: #666;
      margin-bottom: 16px;
      line-height: 1.6;
    }
    
    .note {
      font-size: 16px;
      color: #666;
      margin-top: 32px;
      padding-top: 32px;
      border-top: 1px solid #eee;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✉️</div>
    <h1>Check Your Email</h1>
    <p>If your email address is authorized, you'll receive an access link shortly.</p>
    <p>Please check your inbox and spam folder.</p>
    <p>The link will expire in 15 minutes.</p>
    
    <div class="note">
      For security reasons, we cannot confirm whether any specific email addresses are authorized for access on this website.
    </div>
  </div>
</body>
</html>`;
