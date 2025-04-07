# CI/CD Guide for Notification Worker

This document explains the Continuous Integration and Continuous Deployment (CI/CD) setup for the Notification Worker service.

## What is CI/CD?

**Continuous Integration (CI)** is the practice of frequently merging code changes into a shared repository, followed by automated building and testing to ensure the changes don't break the application.

**Continuous Deployment (CD)** is the practice of automatically deploying code changes to production environments after passing all tests and quality checks.

## CI/CD Options

We have set up two CI/CD options:

1. **Google Cloud Build**: For deployment in Google Cloud Platform
2. **GitHub Actions**: For an alternative deployment pipeline using GitHub's CI/CD service

## CI/CD Pipeline Overview

Our CI/CD pipeline automates the following steps:

1. **Build**: Compile TypeScript code to JavaScript
2. **Test**: Run unit tests and integration tests
3. **Lint**: Check code quality and standards
4. **Package**: Build Docker container image
5. **Deploy**: Deploy to Cloud Run in Google Cloud Platform

## Cloud Build Configuration

The pipeline is defined in `cloudbuild.yaml` and includes the following steps:

### 1. Install Dependencies
```yaml
- name: 'node:18'
  id: 'install'
  entrypoint: npm
  args: ['install']
```

### 2. Run Linting
```yaml
- name: 'node:18'
  id: 'lint'
  entrypoint: npm
  args: ['run', 'lint']
  waitFor: ['install']
```

### 3. Run Type Checking
```yaml
- name: 'node:18'
  id: 'typecheck'
  entrypoint: npm
  args: ['run', 'typecheck']
  waitFor: ['install']
```

### 4. Run Tests
```yaml
- name: 'node:18'
  id: 'test'
  entrypoint: npm
  args: ['test']
  waitFor: ['install']
```

### 5. Build Application
```yaml
- name: 'node:18'
  id: 'build'
  entrypoint: npm
  args: ['run', 'build']
  waitFor: ['lint', 'typecheck', 'test']
```

### 6. Build Docker Image
```yaml
- name: 'gcr.io/cloud-builders/docker'
  id: 'build-image'
  args: [
    'build',
    '--tag', 'gcr.io/$PROJECT_ID/notification-worker:$COMMIT_SHA',
    '--tag', 'gcr.io/$PROJECT_ID/notification-worker:latest',
    '.'
  ]
  waitFor: ['build']
```

### 7. Push Docker Image
```yaml
- name: 'gcr.io/cloud-builders/docker'
  id: 'push-image'
  args: ['push', 'gcr.io/$PROJECT_ID/notification-worker:$COMMIT_SHA']
  waitFor: ['build-image']
```

### 8. Deploy to Cloud Run
```yaml
- name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
  id: 'deploy'
  entrypoint: gcloud
  args: [
    'run', 'deploy', 'notification-worker',
    '--image', 'gcr.io/$PROJECT_ID/notification-worker:$COMMIT_SHA',
    '--platform', 'managed',
    '--region', 'us-central1',
    '--set-env-vars', 'NODE_ENV=production,GOOGLE_CLOUD_PROJECT=$PROJECT_ID',
    '--allow-unauthenticated'
  ]
  waitFor: ['push-image']
```

## Setting Up the Pipeline

1. **Enable Cloud Build API** in your Google Cloud project
2. **Create a Cloud Build Trigger** linked to your GitHub repository
3. **Configure Environment Variables** for your Cloud Run service
4. **Setup Secrets** for sensitive information

## Environment Variables

The following environment variables are needed for the deployment:

- `NODE_ENV`: Set to `production` for production deployments
- `GOOGLE_CLOUD_PROJECT`: Your Google Cloud project ID
- `PUBSUB_SUBSCRIPTION`: The PubSub subscription name
- `DLQ_TOPIC`: Dead letter queue topic name
- `LOG_LEVEL`: Logging level (info, debug, warn, error)

Database variables:
- `DB_USER`: Database username
- `DB_PASSWORD`: Database password
- `DB_NAME`: Database name

## Secret Management

Sensitive information like database passwords should be stored as secrets:

1. Create secrets in Secret Manager:
```bash
gcloud secrets create DB_PASSWORD --replication-policy=automatic
gcloud secrets versions add DB_PASSWORD --data-file=/path/to/password/file
```

2. Grant access to the Cloud Run service account:
```bash
gcloud secrets add-iam-policy-binding DB_PASSWORD \
  --member=serviceAccount:service-account-name@project-id.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

3. Reference secrets in Cloud Run:
```bash
gcloud run deploy notification-worker \
  --image=gcr.io/project-id/notification-worker \
  --set-secrets=DB_PASSWORD=DB_PASSWORD:latest
```

## Pipeline Monitoring

You can monitor the pipeline execution in the Cloud Build console:

1. Go to Cloud Build > History to see all builds
2. Click on a build to see detailed logs
3. Review build success/failure and individual step results

## Rollback Strategy

If a deployment fails or causes issues:

1. **Automatic Rollback**: Cloud Run keeps previous versions for quick rollback
2. **Manual Rollback**: Deploy a previous known-good image
```bash
gcloud run deploy notification-worker \
  --image=gcr.io/$PROJECT_ID/notification-worker:previous-commit-sha
```

## GitHub Actions Workflow

We've also set up GitHub Actions as an alternative CI/CD pipeline. The workflow is defined in `.github/workflows/ci-cd.yml` and includes:

### Build Job
- Checkout code
- Set up Node.js
- Install dependencies
- Check code formatting
- Run linting
- Run type checking
- Run tests
- Build TypeScript code
- Upload build artifacts

### Deploy Job
- Download build artifacts
- Set up Google Cloud SDK
- Authenticate to Google Cloud Platform
- Build and push Docker image
- Deploy to Cloud Run
- Test the deployment

### Required Secrets

To use GitHub Actions, you need to set up the following secrets:

- `GCP_PROJECT_ID`: Your Google Cloud project ID
- `GCP_WORKLOAD_IDENTITY_PROVIDER`: Workload Identity Provider for GitHub Actions
- `GCP_SERVICE_ACCOUNT_EMAIL`: Service account email for deployment
- `GCP_SA_KEY`: Service account key JSON for Google Container Registry
- `PUBSUB_SUBSCRIPTION`: PubSub subscription name
- `DLQ_TOPIC`: Dead letter queue topic name

## Best Practices

1. **Small, Frequent Commits**: Make small, focused changes that are easier to review and test
2. **Branch Protection**: Require code reviews and passing CI checks before merging
3. **Environment Promotion**: Test in staging before promoting to production
4. **Artifact Versioning**: Use commit SHAs and tags for precise tracking
5. **Monitoring Integration**: Set up alerts for build failures and deployment issues
6. **Secrets Management**: Store sensitive information securely in the CI/CD system
7. **Pipeline Testing**: Regularly test the CI/CD pipeline itself