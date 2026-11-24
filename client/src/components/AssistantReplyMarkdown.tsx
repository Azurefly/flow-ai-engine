import Markdown from "markdown-to-jsx";

const options = {
  disableParsingRawHTML: true,
  overrides: {
    img: ({ alt }: { alt?: string }) => <>{alt}</>,
    a: { props: { target: "_blank", rel: "noopener noreferrer" } },
  },
};

export default function AssistantReplyMarkdown({ content }: { content: string }) {
  return <div className="assistant-markdown">
    <Markdown options={options}>{content}</Markdown>
  </div>;
}
