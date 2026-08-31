# Releasing XOXO

## First npm release

The initial release establishes the `xoxo-eval` package before npm can attach a trusted publisher.
Trusted-publisher setup requires npm 11.5.1 or newer.

```sh
npm login
npm publish
npm trust github xoxo-eval \
  --file publish.yml \
  --repo justjammin/xoxo \
  --allow-publish \
  --yes
```

The trusted-publisher command authorizes only `.github/workflows/publish.yml` in `justjammin/xoxo`. It does not create or store a long-lived npm write token.

You can publish the matching `v0.1.0` GitHub Release after the manual npm publish. The workflow recognizes that `xoxo-eval@0.1.0` already exists, runs its verification gates, and skips the duplicate publish.

## Later releases

1. Update the version in `package.json` and refresh `bun.lock`.
2. Merge and push the release commit to `main`.
3. Publish a non-prerelease GitHub Release whose tag is exactly `v<package version>`.

The workflow installs from `bun.lock`, runs the complete test and build gate, verifies the release tag, and publishes through npm trusted publishing. npm automatically attaches provenance for this public repository and package.
