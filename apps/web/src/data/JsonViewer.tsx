import styles from './JsonViewer.module.css';

interface JsonViewerProps {
  readonly data: unknown;
  readonly label?: string;
}

export function JsonViewer({ data, label }: JsonViewerProps): JSX.Element {
  const formatted = JSON.stringify(data, null, 2);
  return (
    <div className={styles.wrapper}>
      {label && <span className={styles.label}>{label}</span>}
      <pre className={styles.pre}>{formatted}</pre>
    </div>
  );
}
