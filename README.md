# longbranch-farms
Long Branch Farms was born out of a desire to provide our community with fresh, healthy, locally grown food. We believe people should know exactly where their food comes from, how it’s raised, and how it's cared for every single day.


## Contact form (Web3Forms)

The contact page (`contact/index.html`) sends messages through **Web3Forms**, a free
hosted form service. It is live and configured — there is no server to run and
nothing to install or deploy alongside the site.

- Submissions arrive as email at `longbranchfarmsky@gmail.com`.
- The account and its settings are managed at https://web3forms.com.
- The form is not tied to any host, so it keeps working wherever the site ends
  up being deployed.
- **The free plan allows 250 submissions per month.** Past that, Web3Forms
  rejects submissions and visitors see the form's failure message. Real
  inquiries would be lost, so if traffic or spam picks up, watch the count in
  the Web3Forms dashboard and either upgrade or rotate the key.

**Where the key lives.** `contact/index.html` contains one line:

```html
<input type="hidden" name="access_key" value="..." />
```

That access key is public by design. It is a routing identifier, not a password:
it can only hand a submission to Web3Forms for delivery to the farm's inbox, and
it cannot be used to read anything. Every site using Web3Forms has its key
visible in page source.

**To rotate it** (worth doing if the form starts drawing spam, which eats into
the monthly submission allowance): sign in at
web3forms.com with `longbranchfarmsky@gmail.com`, generate a new access key, and
paste it into that one line in `contact/index.html`. Nothing else changes.

If the form ever fails to send, the page keeps the visitor's typed message on
screen and shows the farm's phone number and email address, so nobody hits a
dead end.

## Website editor

The Sveltia CMS editor lives at `/admin/`. See [the editor guide](docs/CMS-Guide.md)
for Courtney's photo and wording instructions, the GitHub/OAuth activation steps,
and developer verification. Products and orders remain in Shopify.
