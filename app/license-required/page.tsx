export default function LicenseRequiredPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#f3f4f6',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, sans-serif'
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '12px',
        padding: '48px',
        maxWidth: '480px',
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)'
      }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
        <h1 style={{
          fontSize: '24px',
          fontWeight: '700',
          color: '#111827',
          margin: '0 0 12px 0'
        }}>
          License Required
        </h1>
        <p style={{ color: '#6b7280', fontSize: '15px', lineHeight: '1.6', margin: '0 0 24px 0' }}>
          This store requires a valid license to operate.
          Please contact the developer to activate or renew your license.
        </p>
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          padding: '16px',
          fontSize: '13px',
          color: '#dc2626'
        }}>
          License key invalid or revoked
        </div>
        {process.env.NEXT_PUBLIC_SUPPORT_EMAIL && (
          <p style={{ marginTop: '24px', fontSize: '13px', color: '#9ca3af' }}>
            Contact:{' '}
            <a
              href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL}`}
              style={{ color: '#2563eb' }}
            >
              {process.env.NEXT_PUBLIC_SUPPORT_EMAIL}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
