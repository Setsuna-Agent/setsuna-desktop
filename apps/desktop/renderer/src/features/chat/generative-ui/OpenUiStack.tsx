import type { ComponentRenderer } from '@openuidev/react-lang';

export function withResponsiveOpenUiStack(name: string, Render: ComponentRenderer): ComponentRenderer {
  if (name !== 'Stack') return Render;

  return function ResponsiveStack(props) {
    // Expose direction without duplicating upstream layout rules. The scope has
    // no layout box, so nested stacks remain flex items of their original parent.
    return (
      <div className="chat-openui-stack" data-direction={props.props.direction ?? 'column'}>
        <Render {...props} />
      </div>
    );
  };
}
