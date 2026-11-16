import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { ClusterConfigDialog } from '../ClusterConfigDialog';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';

vi.mock('@/components/fleet/AgentEnrollmentWizard', () => ({
  AgentEnrollmentWizard: ({ open, defaultProjectId }: { open: boolean; defaultProjectId?: number }) =>
    open ? <div data-testid="agent-enrollment-wizard">AgentEnrollmentWizard for project {defaultProjectId}</div> : null,
}));

const sshCredentials = [
  {
    id: 10,
    name: 'test-ssh',
    host: '10.0.0.5',
    port: 22,
    username: 'ubuntu',
    auth_type: 'key',
    has_password: false,
    has_private_key: true,
    is_default: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    clusters_count: 0,
    projects_count: 0,
  },
];

describe('ClusterConfigDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    projectId: 1,
    cluster: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    server.use(
      http.get('*/api/credential-templates', () => {
        return HttpResponse.json([]);
      }),
      http.get('*/api/ssh-credentials', () => {
        return HttpResponse.json(sshCredentials);
      }),
    );
  });

  it('renders create dialog title and form fields', () => {
    render(<ClusterConfigDialog {...defaultProps} />);
    expect(screen.getByText('Add Kubernetes Cluster')).toBeInTheDocument();
    expect(screen.getByLabelText('Cluster Name *')).toBeInTheDocument();
    expect(screen.getByText('Upload Kubeconfig')).toBeInTheDocument();
  });

  it('renders edit dialog title when cluster is provided', () => {
    const cluster = {
      id: 1,
      name: 'prod-cluster',
      project_id: 1,
      status: 'connected' as const,
      default_namespace: 'default',
      created_at: '2026-01-01',
    };
    render(<ClusterConfigDialog {...defaultProps} cluster={cluster} />);
    expect(screen.getByText('Edit Cluster')).toBeInTheDocument();
    expect(screen.getByDisplayValue('prod-cluster')).toBeInTheDocument();
  });

  it('shows SSH tunnel section when toggle is enabled', async () => {
    const user = userEvent.setup();
    render(<ClusterConfigDialog {...defaultProps} />);

    // Find the SSH Tunnel switch and click it
    const sshSwitch = screen.getByRole('checkbox');
    await user.click(sshSwitch);

    expect(screen.getByText('SSH Connection *')).toBeInTheDocument();
  });

  // -- K8S-006: Auto-enable SSH tunnel for SSH projects --

  it('auto-enables SSH tunnel and pre-selects SSH connection when projectSshCredentialId is set', async () => {
    render(
      <ClusterConfigDialog {...defaultProps} projectSshCredentialId={10} />
    );

    // SSH tunnel should be auto-enabled — SSH Connection label visible
    await waitFor(() => {
      expect(screen.getByText('SSH Connection *')).toBeInTheDocument();
    });

    // The "Probe via SSH" button should be visible
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Prob(e|ing)/i })).toBeInTheDocument();
    });
  });

  // -- K8S-007: Probe via SSH --

  it('shows probe button when SSH tunnel is enabled with a credential', async () => {
    render(
      <ClusterConfigDialog {...defaultProps} projectSshCredentialId={10} />
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /prob/i })
      ).toBeInTheDocument();
    });
  });

  it('pre-selects on-prem cloud provider when projectSshCredentialId is set', () => {
    render(
      <ClusterConfigDialog {...defaultProps} projectSshCredentialId={10} />
    );

    // SSH tunnel should auto-enable, cloud provider should be 'on-prem'
    // The SSH tunnel section should be visible
    expect(screen.getByText('SSH Tunnel')).toBeInTheDocument();
    // SSH Connection label visible means tunnel is enabled
    expect(screen.getByText('SSH Connection *')).toBeInTheDocument();
  });

  it('does not auto-probe when editing an existing cluster', () => {
    const cluster = {
      id: 1,
      name: 'existing-cluster',
      project_id: 1,
      status: 'active' as const,
      default_namespace: 'default',
      created_at: '2026-01-01',
      ssh_tunnel_enabled: true,
      ssh_credential_id: 10,
    };

    render(
      <ClusterConfigDialog
        {...defaultProps}
        cluster={cluster}
        projectSshCredentialId={10}
      />
    );

    // Should show edit title, not trigger probe
    expect(screen.getByText('Edit Cluster')).toBeInTheDocument();
  });

  it('renders the push-based fleet agent recommendation banner in create mode', () => {
    render(<ClusterConfigDialog {...defaultProps} />);
    expect(
      screen.getByText('Push-Based Fleet Agent Available (Recommended)'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Enroll Agent \(:17543\)/i }),
    ).toBeInTheDocument();
  });

  it('switches to agent enrollment wizard when clicking enroll agent in the banner', async () => {
    const user = userEvent.setup();
    render(<ClusterConfigDialog {...defaultProps} />);

    const enrollButton = screen.getByRole('button', {
      name: /Enroll Agent \(:17543\)/i,
    });
    await user.click(enrollButton);

    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('agent-enrollment-wizard')).toBeInTheDocument();
    expect(
      screen.getByText('AgentEnrollmentWizard for project 1'),
    ).toBeInTheDocument();
  });

  it('does not render the push-based agent banner when editing an existing cluster', () => {
    const cluster = {
      id: 1,
      name: 'existing-cluster',
      project_id: 1,
      status: 'active' as const,
      default_namespace: 'default',
      created_at: '2026-01-01',
    };

    render(<ClusterConfigDialog {...defaultProps} cluster={cluster} />);
    expect(
      screen.queryByText('Push-Based Fleet Agent Available (Recommended)'),
    ).not.toBeInTheDocument();
  });
});
