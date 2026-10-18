/*! @license DOMPurify 3.4.8 | (c) Cure53 and other contributors | Released under the Apache license 2.0 and Mozilla Public License 2.0 | github.com/cure53/DOMPurify/blob/3.4.8/LICENSE */

import { TrustedTypePolicy, TrustedTypesWindow, TrustedHTML } from 'trusted-types/lib/index.js';

interface Config {
    ADD_ATTR?: string[] | ((attributeName: string, tagName: string) => boolean) | undefined;
    ADD_DATA_URI_TAGS?: string[] | undefined;
    ADD_TAGS?: string[] | ((tagName: string) => boolean) | undefined;
    ADD_URI_SAFE_ATTR?: string[] | undefined;
    ALLOW_ARIA_ATTR?: boolean | undefined;
    ALLOW_DATA_ATTR?: boolean | undefined;
    ALLOW_UNKNOWN_PROTOCOLS?: boolean | undefined;
    ALLOW_SELF_CLOSE_IN_ATTR?: boolean | undefined;
    ALLOWED_ATTR?: string[] | undefined;
    ALLOWED_TAGS?: string[] | undefined;
    ALLOWED_NAMESPACES?: string[] | undefined;
    ALLOWED_URI_REGEXP?: RegExp | undefined;
    CUSTOM_ELEMENT_HANDLING?: {
        tagNameCheck?: RegExp | ((tagName: string) => boolean) | null | undefined;
        attributeNameCheck?: RegExp | ((attributeName: string, tagName?: string) => boolean) | null | undefined;
        allowCustomizedBuiltInElements?: boolean | undefined;
    };
    FORBID_ATTR?: string[] | undefined;
    FORBID_CONTENTS?: string[] | undefined;
    ADD_FORBID_CONTENTS?: string[] | undefined;
    FORBID_TAGS?: string[] | undefined;
    FORCE_BODY?: boolean | undefined;
    HTML_INTEGRATION_POINTS?: Record<string, boolean> | undefined;
    IN_PLACE?: boolean | undefined;
    KEEP_CONTENT?: boolean | undefined;
    MATHML_TEXT_INTEGRATION_POINTS?: Record<string, boolean> | undefined;
    NAMESPACE?: string | undefined;
    PARSER_MEDIA_TYPE?: DOMParserSupportedType | undefined;
    RETURN_DOM_FRAGMENT?: boolean | undefined;
    RETURN_DOM?: boolean | undefined;
    RETURN_TRUSTED_TYPE?: boolean | undefined;
    SAFE_FOR_TEMPLATES?: boolean | undefined;
    SAFE_FOR_XML?: boolean | undefined;
    SANITIZE_DOM?: boolean | undefined;
    SANITIZE_NAMED_PROPS?: boolean | undefined;
    TRUSTED_TYPES_POLICY?: TrustedTypePolicy | null | undefined;
    USE_PROFILES?: false | UseProfilesConfig | undefined;
    WHOLE_DOCUMENT?: boolean | undefined;
}
interface UseProfilesConfig {
    mathMl?: boolean | undefined;
    svg?: boolean | undefined;
    svgFilters?: boolean | undefined;
    html?: boolean | undefined;
}

declare const _default: DOMPurify;

interface DOMPurify {
    (root?: WindowLike): DOMPurify;
    version: string;
    removed: Array<RemovedElement | RemovedAttribute>;
    isSupported: boolean;
    setConfig(cfg?: Config): void;
    clearConfig(): void;
    sanitize(dirty: string | Node, cfg: Config & {
        RETURN_TRUSTED_TYPE: true;
    }): TrustedHTML;
    sanitize(dirty: Node, cfg: Config & {
        IN_PLACE: true;
    }): Node;
    sanitize(dirty: string | Node, cfg: Config & {
        RETURN_DOM: true;
    }): Node;
    sanitize(dirty: string | Node, cfg: Config & {
        RETURN_DOM_FRAGMENT: true;
    }): DocumentFragment;
    sanitize(dirty: string | Node, cfg?: Config): string;
    isValidAttribute(tag: string, attr: string, value: string): boolean;
    addHook(entryPoint: BasicHookName, hookFunction: NodeHook): void;
    addHook(entryPoint: ElementHookName, hookFunction: ElementHook): void;
    addHook(entryPoint: DocumentFragmentHookName, hookFunction: DocumentFragmentHook): void;
    addHook(entryPoint: 'uponSanitizeElement', hookFunction: UponSanitizeElementHook): void;
    addHook(entryPoint: 'uponSanitizeAttribute', hookFunction: UponSanitizeAttributeHook): void;
    removeHook(entryPoint: BasicHookName, hookFunction?: NodeHook): NodeHook | undefined;
    removeHook(entryPoint: ElementHookName, hookFunction?: ElementHook): ElementHook | undefined;
    removeHook(entryPoint: DocumentFragmentHookName, hookFunction?: DocumentFragmentHook): DocumentFragmentHook | undefined;
    removeHook(entryPoint: 'uponSanitizeElement', hookFunction?: UponSanitizeElementHook): UponSanitizeElementHook | undefined;
    removeHook(entryPoint: 'uponSanitizeAttribute', hookFunction?: UponSanitizeAttributeHook): UponSanitizeAttributeHook | undefined;
    removeHooks(entryPoint: HookName): void;
    removeAllHooks(): void;
}
interface RemovedElement {
    element: Node;
}
interface RemovedAttribute {
    attribute: Attr | null;
    from: Node;
}
type BasicHookName = 'beforeSanitizeElements' | 'afterSanitizeElements' | 'uponSanitizeShadowNode';
type ElementHookName = 'beforeSanitizeAttributes' | 'afterSanitizeAttributes';
type DocumentFragmentHookName = 'beforeSanitizeShadowDOM' | 'afterSanitizeShadowDOM';
type UponSanitizeElementHookName = 'uponSanitizeElement';
type UponSanitizeAttributeHookName = 'uponSanitizeAttribute';
type HookName = BasicHookName | ElementHookName | DocumentFragmentHookName | UponSanitizeElementHookName | UponSanitizeAttributeHookName;
type NodeHook = (this: DOMPurify, currentNode: Node, hookEvent: null, config: Config) => void;
type ElementHook = (this: DOMPurify, currentNode: Element, hookEvent: null, config: Config) => void;
type DocumentFragmentHook = (this: DOMPurify, currentNode: DocumentFragment, hookEvent: null, config: Config) => void;
type UponSanitizeElementHook = (this: DOMPurify, currentNode: Node, hookEvent: UponSanitizeElementHookEvent, config: Config) => void;
type UponSanitizeAttributeHook = (this: DOMPurify, currentNode: Element, hookEvent: UponSanitizeAttributeHookEvent, config: Config) => void;
interface UponSanitizeElementHookEvent {
    tagName: string;
    allowedTags: Record<string, boolean>;
}
interface UponSanitizeAttributeHookEvent {
    attrName: string;
    attrValue: string;
    keepAttr: boolean;
    allowedAttributes: Record<string, boolean>;
    forceKeepAttr: boolean | undefined;
}
type WindowLike = Pick<typeof globalThis, 'DocumentFragment' | 'HTMLTemplateElement' | 'Node' | 'Element' | 'NodeFilter' | 'NamedNodeMap' | 'HTMLFormElement' | 'DOMParser'> & {
    document?: Document;
    MozNamedAttrMap?: typeof window.NamedNodeMap;
} & Pick<TrustedTypesWindow, 'trustedTypes'>;

export { _default as default };
export type { Config, DOMPurify, DocumentFragmentHook, ElementHook, HookName, NodeHook, RemovedAttribute, RemovedElement, UponSanitizeAttributeHook, UponSanitizeAttributeHookEvent, UponSanitizeElementHook, UponSanitizeElementHookEvent, WindowLike };