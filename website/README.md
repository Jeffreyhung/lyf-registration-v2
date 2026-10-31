<p align="center">
  <a href="https://lyf.tacl.org/">
    <img alt="LYF Logo" src="https://github.com/TACL-LYF/lyf-website/blob/main/static/lyf-logo-black.png" width="60" />
  </a>
</p>
<h1 align="center">
  TACL-LYF Registration Website
</h1>

Gatsby 5 / React 18 / MUI site: the registration and pre-registration flows,
the parent profile page and the admin dashboard at `/admin`.

- **Setup, env files, running locally:** [docs/local-development.md](../docs/local-development.md)
  (install from the repo root with `yarn install`, then `yarn develop` here).
- **How registration works end to end:** [docs/architecture-registration.md](../docs/architecture-registration.md)
- **Admin dashboard, exports, camp year rollover:** [docs/admin-runbook.md](../docs/admin-runbook.md)
- **Deploying (GitHub Pages):** [docs/deployment.md](../docs/deployment.md)

## Libraries Used

- [react-spring](https://beta.react-spring.dev/) for animations
- [MUI components](https://mui.com/) for base UI components

## File Structure

### Root Level Files

- [gatsby-config.ts](gatsby-config.ts): This file contains all the configuration for the Gatsby site including what [plugins](https://www.gatsbyjs.com/plugins) we use and site metadata.
- [gatsby-browser.tsx](gatsby-browser.tsx): Contains the [APIs](https://www.gatsbyjs.com/docs/reference/config-files/gatsby-browser/) we call when events happen client-side on the browser
- [gatsby-ssr.tsx](gatsby-ssr.tsx): Contains the [APIs](https://www.gatsbyjs.com/docs/reference/config-files/gatsby-ssr/) we call when events happen server-side during compilation
- [gatsby-node.ts](gatsby-node.ts): Contains the [APIs](https://www.gatsbyjs.com/docs/reference/config-files/gatsby-node/) that plugins and we can use to build pages and do other cool things

### Directories

- [src/pages/](src/pages/): All of the hard-coded pages for the site. Gatsby takes each of these files and converts them to a page with the path `https://sitename.com/[filename]`
- [src/components/](src/components/): All of the components that make up the site! Each folder represents related components such as the [Header](src/components/Header/) folder which contains the sub components that make up the Header. Generally if a component is re-usable it'll have its own subfolder under components
- [src/hooks/](src/hooks/): Hooks are a [React-specific concept](https://reactjs.org/docs/hooks-intro.html) that enable functionality such as state and many other things
- [src/utils/](src/utils/): Firebase app setup, date/time helpers, enums and other shared helpers
