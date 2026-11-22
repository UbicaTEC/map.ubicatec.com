import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

type Props={
    children: string;
    className?:string;
};

export function MarkdownDescription({ children, className }: Props) {
    return (
        <div className={className}>
            <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                {children}
            </ReactMarkdown>
        </div>
        );
    }