provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type        = string
  description = "The Google Cloud Project ID"
  default     = "scandoc-production"
}

variable "region" {
  type        = string
  description = "The target deployment region"
  default     = "us-central1"
}

variable "gemini_api_key" {
  type        = string
  description = "The Google Gemini API Key"
  sensitive   = true
}

# 1. Cloud Storage Bucket for Document Storage
resource "google_storage_bucket" "doc_bucket" {
  name          = "scandoc-docs-vault-${var.project_id}"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }
}

# 2. Secret Manager for Gemini API Key
resource "google_secret_manager_secret" "gemini_key" {
  secret_id = "GEMINI_API_KEY"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "gemini_key_version" {
  secret      = google_secret_manager_secret.gemini_key.id
  secret_data = var.gemini_api_key
}

# 3. Cloud SQL PostgreSQL Database
resource "google_sql_database_instance" "postgres_instance" {
  name             = "scandoc-postgres-db"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier = "db-g1-small" # Developer small instance, scale up for production
    backup_configuration {
      enabled = true
    }
  }
  deletion_protection = false # Set to true for production databases to prevent accidental deletion
}

resource "google_sql_database" "scandoc_db" {
  name     = "scandoc"
  instance = google_sql_database_instance.postgres_instance.name
}

resource "google_sql_user" "postgres_user" {
  name     = "postgres"
  instance = google_sql_database_instance.postgres_instance.name
  password = "scandoc-secure-password-2026"
}

# 4. Artifact Registry Repository
resource "google_artifact_registry_repository" "docker_repo" {
  location      = var.region
  repository_id = "scandoc-containers"
  description   = "Docker containers repository for SCANDOC"
  format        = "DOCKER"
}

# 5. IAM Access Configuration for Cloud Run Service Account
data "google_project" "project" {}

resource "google_secret_manager_secret_iam_member" "secret_accessor" {
  secret_id = google_secret_manager_secret.gemini_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_member" "cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

# 6. Cloud Run Backend Service
resource "google_cloud_run_v2_service" "backend_service" {
  name     = "scandoc-backend"
  location = var.region

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/backend:latest"
      ports {
        container_port = 3001
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "GCS_BUCKET_NAME"
        value = google_storage_bucket.doc_bucket.name
      }
      env {
        name  = "DB_HOST"
        value = "/cloudsql/${google_sql_database_instance.postgres_instance.connection_name}"
      }
      env {
        name  = "DB_DATABASE"
        value = google_sql_database.scandoc_db.name
      }
      env {
        name  = "DB_USER"
        value = "postgres"
      }
      env {
        name  = "DB_PASSWORD"
        value = "scandoc-secure-password-2026"
      }
      env {
        name  = "DB_PORT"
        value = "5432"
      }
      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_key.secret_id
            version = "latest"
          }
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres_instance.connection_name]
      }
    }
  }
}

# 7. Cloud Run Frontend Service
resource "google_cloud_run_v2_service" "frontend_service" {
  name     = "scandoc-frontend"
  location = var.region

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/frontend:latest"
      ports {
        container_port = 80
      }
    }
  }
}
