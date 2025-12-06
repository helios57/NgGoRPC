# Release Procedure

This document outlines the process for creating and publishing releases of NgGoRPC.

## Prerequisites

- Write access to the repository
- npm account with publish permissions (for npm releases)
- GitHub repository access for creating releases

## Release Steps

### 1. Prepare the Release

1. **Ensure all tests pass**
   ```bash
   # Run Go tests
   cd wsgrpc
   go test -v -race -coverprofile=coverage.out ./...
   
   # Run Angular tests
   cd ../frontend
   npm test:client -- --coverage --watch=false
   
   # Run E2E tests
   cd ../e2e-tests
   npm test
   ```

2. **Verify code coverage meets thresholds**
   - Go coverage should be ≥ 80%
   - Angular coverage should be ≥ 80%

3. **Update documentation**
   - Review and update README.md if needed
   - Update any API documentation changes
   - Review CHANGELOG.md or create one if it doesn't exist

### 2. Version Bump

1. **Update Angular package version**
   ```bash
   cd frontend/projects/client
   # Edit package.json and update version field
   # Example: "version": "1.2.0"
   ```

2. **Update Go module version (optional for Go)**
   - Go uses Git tags for versioning, but you may document the version in comments

3. **Commit version changes**
   ```bash
   git add .
   git commit -m "chore: bump version to vX.Y.Z"
   git push origin main
   ```

### 3. Create Git Tag

1. **Tag the release**
   ```bash
   git tag -a vX.Y.Z -m "Release version X.Y.Z"
   git push origin vX.Y.Z
   ```

2. **Tag format**
   - Use semantic versioning: `vMAJOR.MINOR.PATCH`
   - `vMAJOR`: Breaking changes
   - `vMINOR`: New features (backward compatible)
   - `vPATCH`: Bug fixes (backward compatible)

### 4. Build Release Artifacts

1. **Build Angular library**
   ```bash
   cd frontend
   npm run build:lib
   ```
   
   Artifacts will be in: `frontend/dist/client/`

2. **Go library** (no build needed)
   - Go packages are distributed via source code
   - Users will import directly from GitHub

### 5. Publish to npm (Optional)

If publishing the Angular library to npm:

```bash
cd frontend/dist/client
npm publish --access public
```

### 6. Create GitHub Release

1. **Navigate to GitHub Releases**
   - Go to: `https://github.com/helios57/NgGoRPC/releases`
   - Click "Draft a new release"

2. **Fill in release details**
   - **Tag**: Select the tag you created (vX.Y.Z)
   - **Release title**: `NgGoRPC vX.Y.Z`
   - **Description**: Include:
     - Summary of changes
     - New features
     - Bug fixes
     - Breaking changes (if any)
     - Migration guide (if needed)

3. **Attach artifacts (optional)**
   - Upload `frontend/dist/client/` as a zip if not publishing to npm

4. **Publish release**
   - Click "Publish release"

### 7. Announce the Release

1. **Update documentation sites** (if applicable)
2. **Notify users** through appropriate channels
3. **Update any example repositories** that depend on NgGoRPC

## Version Strategy

### Major Version (X.0.0)
- Breaking API changes
- Major protocol changes
- Removal of deprecated features

### Minor Version (0.X.0)
- New features (backward compatible)
- New configuration options
- Performance improvements
- New DI providers or helpers

### Patch Version (0.0.X)
- Bug fixes
- Documentation updates
- Minor performance improvements
- Security patches

## Rollback Procedure

If a release needs to be rolled back:

1. **Delete the problematic tag**
   ```bash
   git tag -d vX.Y.Z
   git push origin :refs/tags/vX.Y.Z
   ```

2. **Unpublish from npm** (if applicable)
   ```bash
   npm unpublish @nggorpc/client@X.Y.Z
   ```
   Note: npm unpublish has time restrictions (24 hours)

3. **Mark GitHub release as pre-release or delete it**

4. **Investigate and fix the issue**

5. **Create a new patch release with the fix**

## CI/CD Integration (Future)

The CI pipeline in `.github/workflows/ci.yml` can be extended to:

1. **Automatically create releases on tag push**
2. **Build and upload artifacts to GitHub Releases**
3. **Publish to npm registry automatically**
4. **Run additional release verification tests**

Example workflow addition:
```yaml
on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    name: Create Release
    runs-on: ubuntu-latest
    steps:
      - name: Create GitHub Release
        uses: actions/create-release@v1
        # ... configuration
```

## Checklist

Before releasing, ensure:

- [ ] All tests pass (unit, integration, E2E)
- [ ] Code coverage meets thresholds (≥80%)
- [ ] Documentation is up to date
- [ ] Version bumped in package.json
- [ ] Git tag created
- [ ] Release notes written
- [ ] Artifacts built and verified
- [ ] Release published on GitHub
- [ ] npm package published (if applicable)
- [ ] Team notified

## Support Policy

- **Latest major version**: Full support
- **Previous major version**: Security fixes only
- **Older versions**: No support (upgrade recommended)

## Questions or Issues?

For questions about the release process, contact the maintainers or open an issue.
