{{/*
Expand the name of the chart.
*/}}
{{- define "forge-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "forge-agent.fullname" -}}
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
{{- define "forge-agent.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "forge-agent.labels" -}}
helm.sh/chart: {{ include "forge-agent.chart" . }}
{{ include "forge-agent.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: bnk-forge
{{- end }}

{{/*
Selector labels
*/}}
{{- define "forge-agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "forge-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: edge-telemetry
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "forge-agent.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "forge-agent.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Determine Secret Name for Enrollment
*/}}
{{- define "forge-agent.secretName" -}}
{{- if .Values.enrollment.existingSecret }}
{{- .Values.enrollment.existingSecret }}
{{- else }}
{{- printf "%s-enrollment" (include "forge-agent.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Determine Lease Namespace
*/}}
{{- define "forge-agent.leaseNamespace" -}}
{{- default .Release.Namespace .Values.leaderElection.leaseNamespace }}
{{- end }}
