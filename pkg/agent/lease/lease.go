package lease

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// Config defines settings for Kubernetes coordination.k8s.io lease election.
type Config struct {
	Enabled         bool
	LeaseName       string
	LeaseNamespace  string
	Identity        string // nodeName or podName
	LeaseDuration   time.Duration
	RenewDeadline   time.Duration
	KubeAPIServer   string
	TokenPath       string
	CAPath          string
	InsecureSkipTLS bool
	RoundTripper    http.RoundTripper
	HTTPClient      *http.Client
}

// LeaseSpec represents coordination.k8s.io/v1 LeaseSpec.
type LeaseSpec struct {
	HolderIdentity       *string `json:"holderIdentity,omitempty"`
	LeaseDurationSeconds *int32  `json:"leaseDurationSeconds,omitempty"`
	AcquireTime          *string `json:"acquireTime,omitempty"`
	RenewTime            *string `json:"renewTime,omitempty"`
	LeaseTransitions     *int32  `json:"leaseTransitions,omitempty"`
}

// LeaseMetadata represents metadata in Kubernetes Lease.
type LeaseMetadata struct {
	Name            string            `json:"name"`
	Namespace       string            `json:"namespace"`
	ResourceVersion string            `json:"resourceVersion,omitempty"`
	Labels          map[string]string `json:"labels,omitempty"`
}

// Lease represents coordination.k8s.io/v1 Lease object.
type Lease struct {
	APIVersion string        `json:"apiVersion"`
	Kind       string        `json:"kind"`
	Metadata   LeaseMetadata `json:"metadata"`
	Spec       LeaseSpec     `json:"spec"`
}

// Elector manages leader status using Kubernetes Lease API.
type Elector struct {
	cfg Config

	mu              sync.RWMutex
	isLeader        bool
	resourceVersion string
	transitions     int32

	httpClient *http.Client
	token      string
}

// NewElector constructs a new lease Elector.
func NewElector(cfg Config) (*Elector, error) {
	if cfg.LeaseName == "" {
		cfg.LeaseName = "forge-agent-leader"
	}
	if cfg.LeaseNamespace == "" {
		cfg.LeaseNamespace = "forge-system"
	}
	if cfg.Identity == "" {
		hostname, _ := os.Hostname()
		if hostname == "" {
			hostname = "forge-agent-node"
		}
		cfg.Identity = hostname
	}
	if cfg.LeaseDuration <= 0 {
		cfg.LeaseDuration = 15 * time.Second
	}
	if cfg.RenewDeadline <= 0 {
		cfg.RenewDeadline = 10 * time.Second
	}
	if cfg.TokenPath == "" {
		cfg.TokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	}
	if cfg.CAPath == "" {
		cfg.CAPath = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
	}

	client := cfg.HTTPClient
	var token string

	if cfg.Enabled && client == nil {
		var tr http.RoundTripper = cfg.RoundTripper
		if tr == nil {
			tlsConf := &tls.Config{
				InsecureSkipVerify: cfg.InsecureSkipTLS,
			}
			if caBytes, err := os.ReadFile(cfg.CAPath); err == nil {
				pool := x509.NewCertPool()
				pool.AppendCertsFromPEM(caBytes)
				tlsConf.RootCAs = pool
			}

			tr = &http.Transport{
				TLSClientConfig: tlsConf,
			}
		}

		// Read in-cluster service account token if present
		if tokenBytes, err := os.ReadFile(cfg.TokenPath); err == nil {
			token = string(bytes.TrimSpace(tokenBytes))
		}

		client = &http.Client{
			Timeout:   5 * time.Second,
			Transport: tr,
		}
	}

	if cfg.KubeAPIServer == "" {
		host := os.Getenv("KUBERNETES_SERVICE_HOST")
		port := os.Getenv("KUBERNETES_SERVICE_PORT")
		if host != "" && port != "" {
			cfg.KubeAPIServer = fmt.Sprintf("https://%s:%s", host, port)
		} else {
			cfg.KubeAPIServer = "https://kubernetes.default.svc"
		}
	}

	return &Elector{
		cfg:        cfg,
		httpClient: client,
		token:      token,
	}, nil
}

// IsLeader reports whether this instance is currently holding the leader lease.
func (e *Elector) IsLeader() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.isLeader
}

// Run executes the leader election loop until ctx is cancelled.
func (e *Elector) Run(ctx context.Context, onStartedLeading, onStoppedLeading func()) {
	if !e.cfg.Enabled {
		// Leader election disabled: unconditionally assume leadership
		e.mu.Lock()
		e.isLeader = true
		e.mu.Unlock()
		if onStartedLeading != nil {
			onStartedLeading()
		}
		<-ctx.Done()
		if onStoppedLeading != nil {
			onStoppedLeading()
		}
		return
	}

	ticker := time.NewTicker(e.cfg.RenewDeadline / 2)
	defer ticker.Stop()

	for {
		e.step(ctx, onStartedLeading, onStoppedLeading)

		select {
		case <-ctx.Done():
			e.mu.Lock()
			wasLeader := e.isLeader
			e.isLeader = false
			e.mu.Unlock()
			if wasLeader && onStoppedLeading != nil {
				onStoppedLeading()
			}
			return
		case <-ticker.C:
		}
	}
}

func (e *Elector) step(ctx context.Context, onStartedLeading, onStoppedLeading func()) {
	acquired, err := e.TryAcquireOrRenew(ctx)
	if err != nil {
		log.Printf("[lease-elector] Error during lease election: %v", err)
	}

	e.mu.Lock()
	wasLeader := e.isLeader
	e.isLeader = acquired
	e.mu.Unlock()

	if !wasLeader && acquired {
		log.Printf("[lease-elector] Successfully acquired leadership for lease %s/%s as %s", e.cfg.LeaseNamespace, e.cfg.LeaseName, e.cfg.Identity)
		if onStartedLeading != nil {
			onStartedLeading()
		}
	} else if wasLeader && !acquired {
		log.Printf("[lease-elector] Lost leadership for lease %s/%s", e.cfg.LeaseNamespace, e.cfg.LeaseName)
		if onStoppedLeading != nil {
			onStoppedLeading()
		}
	}
}

const k8sMicroTimeFormat = "2006-01-02T15:04:05.000000Z"

// TryAcquireOrRenew attempts to acquire or renew the coordination.k8s.io Lease.
func (e *Elector) TryAcquireOrRenew(ctx context.Context) (bool, error) {
	if !e.cfg.Enabled {
		return true, nil
	}

	now := time.Now().UTC()
	nowRFC := now.Format(k8sMicroTimeFormat)
	durSec := int32(e.cfg.LeaseDuration.Seconds())

	existing, err := e.getLease(ctx)
	if err != nil {
		// If 404, try creating
		if isNotFound(err) {
			trans := int32(1)
			newLease := &Lease{
				APIVersion: "coordination.k8s.io/v1",
				Kind:       "Lease",
				Metadata: LeaseMetadata{
					Name:      e.cfg.LeaseName,
					Namespace: e.cfg.LeaseNamespace,
				},
				Spec: LeaseSpec{
					HolderIdentity:       &e.cfg.Identity,
					LeaseDurationSeconds: &durSec,
					AcquireTime:          &nowRFC,
					RenewTime:            &nowRFC,
					LeaseTransitions:     &trans,
				},
			}
			created, createErr := e.createLease(ctx, newLease)
			if createErr == nil {
				e.mu.Lock()
				e.resourceVersion = created.Metadata.ResourceVersion
				e.transitions = trans
				e.mu.Unlock()
				return true, nil
			}
			return false, createErr
		}
		return false, err
	}

	// Lease exists: check whether it has expired or if we are the holder
	isCurrentHolder := existing.Spec.HolderIdentity != nil && *existing.Spec.HolderIdentity == e.cfg.Identity
	var isExpired bool
	if existing.Spec.RenewTime != nil {
		if renewTime, parseErr := time.Parse(time.RFC3339Nano, *existing.Spec.RenewTime); parseErr == nil {
			leaseDur := e.cfg.LeaseDuration
			if existing.Spec.LeaseDurationSeconds != nil && *existing.Spec.LeaseDurationSeconds > 0 {
				leaseDur = time.Duration(*existing.Spec.LeaseDurationSeconds) * time.Second
			}
			if now.Sub(renewTime) > leaseDur {
				isExpired = true
			}
		}
	} else {
		isExpired = true
	}

	if !isCurrentHolder && !isExpired {
		// Another leader is healthy
		return false, nil
	}

	// We can acquire or renew
	transitions := int32(0)
	if existing.Spec.LeaseTransitions != nil {
		transitions = *existing.Spec.LeaseTransitions
	}
	acquireTime := nowRFC
	if isCurrentHolder && existing.Spec.AcquireTime != nil {
		acquireTime = *existing.Spec.AcquireTime
	} else {
		transitions++
	}

	existing.Spec.HolderIdentity = &e.cfg.Identity
	existing.Spec.LeaseDurationSeconds = &durSec
	existing.Spec.AcquireTime = &acquireTime
	existing.Spec.RenewTime = &nowRFC
	existing.Spec.LeaseTransitions = &transitions

	updated, err := e.updateLease(ctx, existing)
	if err != nil {
		return false, err
	}

	e.mu.Lock()
	e.resourceVersion = updated.Metadata.ResourceVersion
	e.transitions = transitions
	e.mu.Unlock()

	return true, nil
}

func (e *Elector) getLease(ctx context.Context) (*Lease, error) {
	url := fmt.Sprintf("%s/apis/coordination.k8s.io/v1/namespaces/%s/leases/%s", e.cfg.KubeAPIServer, e.cfg.LeaseNamespace, e.cfg.LeaseName)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	e.applyAuth(req)

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, os.ErrNotExist
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var lease Lease
	if err := json.NewDecoder(resp.Body).Decode(&lease); err != nil {
		return nil, err
	}
	return &lease, nil
}

func (e *Elector) createLease(ctx context.Context, lease *Lease) (*Lease, error) {
	url := fmt.Sprintf("%s/apis/coordination.k8s.io/v1/namespaces/%s/leases", e.cfg.KubeAPIServer, e.cfg.LeaseNamespace)
	data, err := json.Marshal(lease)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	e.applyAuth(req)

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("create lease error %d: %s", resp.StatusCode, string(body))
	}

	var created Lease
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		return nil, err
	}
	return &created, nil
}

func (e *Elector) updateLease(ctx context.Context, lease *Lease) (*Lease, error) {
	url := fmt.Sprintf("%s/apis/coordination.k8s.io/v1/namespaces/%s/leases/%s", e.cfg.KubeAPIServer, e.cfg.LeaseNamespace, e.cfg.LeaseName)
	data, err := json.Marshal(lease)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	e.applyAuth(req)

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("update lease error %d: %s", resp.StatusCode, string(body))
	}

	var updated Lease
	if err := json.NewDecoder(resp.Body).Decode(&updated); err != nil {
		return nil, err
	}
	return &updated, nil
}

func (e *Elector) applyAuth(req *http.Request) {
	if e.token != "" {
		req.Header.Set("Authorization", "Bearer "+e.token)
	}
}

func isNotFound(err error) bool {
	return os.IsNotExist(err)
}
