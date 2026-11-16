{{/*
Expand the name of the chart.
*/}}
{{- define "forge-console.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "forge-console.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "forge-console.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "forge-console.labels" -}}
helm.sh/chart: {{ include "forge-console.chart" . }}
{{ include "forge-console.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: bnk-forge
{{- end }}

{{/*
Selector labels
*/}}
{{- define "forge-console.selectorLabels" -}}
app.kubernetes.io/name: {{ include "forge-console.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Database Secret Name
*/}}
{{- define "forge-console.dbSecretName" -}}
{{- printf "%s-postgres-secret" (include "forge-console.fullname" .) }}
{{- end }}

{{/*
License Secret Name
*/}}
{{- define "forge-console.licenseSecretName" -}}
{{- if .Values.license.existingSecret }}
{{- .Values.license.existingSecret }}
{{- else }}
{{- printf "%s-license" (include "forge-console.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Postgres Hostname
*/}}
{{- define "forge-console.postgresHost" -}}
{{- printf "%s-postgres" (include "forge-console.fullname" .) }}
{{- end }}

{{/*
ClickHouse Hostname
*/}}
{{- define "forge-console.clickhouseHost" -}}
{{- printf "%s-clickhouse" (include "forge-console.fullname" .) }}
{{- end }}

{{/*
NATS Hostname
*/}}
{{- define "forge-console.natsHost" -}}
{{- printf "%s-nats" (include "forge-console.fullname" .) }}
{{- end }}
