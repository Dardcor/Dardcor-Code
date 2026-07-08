"""
Dependency Injection Container — TASK-0001 & TASK-0002
=======================================================
Service locator / DI container yang meniru arsitektur VS Code:
  src/vs/platform/instantiation/common/instantiation.ts
  src/vs/platform/instantiation/common/serviceCollection.ts
  src/vs/platform/instantiation/common/instantiationService.ts

Mendukung:
- Service registration (singleton, transient, factory)
- Constructor injection via type hints
- Circular dependency detection
- Lazy initialization
- Scoped containers (child injectors)
"""

from __future__ import annotations

import inspect
import threading
from typing import Any, Callable, Dict, Generic, List, Optional, Set, Type, TypeVar, get_type_hints

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Service Identifier
# ---------------------------------------------------------------------------

class ServiceIdentifier(Generic[T]):
    """
    Typed service token — mirip IServiceIdentifier<T> di VS Code.
    Dipakai sebagai kunci pada service collection.
    """

    def __init__(self, description: str):
        self._description = description

    def __repr__(self) -> str:
        return f"ServiceIdentifier({self._description!r})"

    def __hash__(self) -> int:
        return id(self)

    def __eq__(self, other: object) -> bool:
        return self is other


def create_service_id(description: str) -> ServiceIdentifier:
    """Factory function untuk membuat service identifier."""
    return ServiceIdentifier(description)


# ---------------------------------------------------------------------------
# Service Descriptor
# ---------------------------------------------------------------------------

class _ServiceDescriptor:
    """Internal wrapper yang merepresentasikan registered service."""

    __slots__ = ("_ctor", "_factory", "_instance", "_singleton", "_args", "_kwargs")

    def __init__(
        self,
        *,
        ctor: Optional[Type] = None,
        factory: Optional[Callable] = None,
        instance: Optional[Any] = None,
        singleton: bool = True,
        args: tuple = (),
        kwargs: dict = None,
    ):
        self._ctor = ctor
        self._factory = factory
        self._instance = instance
        self._singleton = singleton
        self._args = args
        self._kwargs = kwargs or {}

    @property
    def is_singleton(self) -> bool:
        return self._singleton

    @property
    def has_instance(self) -> bool:
        return self._instance is not None

    def get_instance(self) -> Any:
        return self._instance

    def set_instance(self, inst: Any) -> None:
        self._instance = inst


# ---------------------------------------------------------------------------
# Circular Dependency Detection
# ---------------------------------------------------------------------------

class CircularDependencyError(Exception):
    pass


# ---------------------------------------------------------------------------
# DI Container (InstantiationService)
# ---------------------------------------------------------------------------

class DIContainer:
    """
    VS Code style Dependency Injection Container.

    Penggunaan:
        container = DIContainer()
        container.register_singleton(IMyService, MyService)
        container.register_factory(IFoo, lambda: Foo())
        container.register_instance(IBar, bar_instance)

        service = container.get(IMyService)
    """

    def __init__(self, parent: Optional["DIContainer"] = None):
        self._services: Dict[ServiceIdentifier, _ServiceDescriptor] = {}
        self._parent = parent
        self._lock = threading.RLock()
        self._resolving: Set[ServiceIdentifier] = set()

    # ------------------------------------------------------------------
    # Registration API
    # ------------------------------------------------------------------

    def register_singleton(
        self,
        identifier: ServiceIdentifier,
        ctor: Type,
        *args: Any,
        **kwargs: Any,
    ) -> None:
        """Register a class that will be instantiated once (singleton)."""
        with self._lock:
            self._services[identifier] = _ServiceDescriptor(
                ctor=ctor, singleton=True, args=args, kwargs=kwargs
            )

    def register_transient(
        self,
        identifier: ServiceIdentifier,
        ctor: Type,
        *args: Any,
        **kwargs: Any,
    ) -> None:
        """Register a class that creates a new instance every call."""
        with self._lock:
            self._services[identifier] = _ServiceDescriptor(
                ctor=ctor, singleton=False, args=args, kwargs=kwargs
            )

    def register_factory(
        self,
        identifier: ServiceIdentifier,
        factory: Callable[[], Any],
        singleton: bool = True,
    ) -> None:
        """Register a factory function."""
        with self._lock:
            self._services[identifier] = _ServiceDescriptor(
                factory=factory, singleton=singleton
            )

    def register_instance(
        self,
        identifier: ServiceIdentifier,
        instance: Any,
    ) -> None:
        """Register an already-created instance (always singleton)."""
        with self._lock:
            desc = _ServiceDescriptor(instance=instance, singleton=True)
            self._services[identifier] = desc

    # ------------------------------------------------------------------
    # Resolution API
    # ------------------------------------------------------------------

    def get(self, identifier: ServiceIdentifier, _chain: Optional[Set] = None) -> Any:
        """
        Resolve a service by its identifier.
        Raises KeyError if not registered.
        Raises CircularDependencyError on circular deps.
        """
        with self._lock:
            chain = _chain or set()

            # Circular dependency check
            if identifier in self._resolving:
                raise CircularDependencyError(
                    f"Circular dependency detected for {identifier}"
                )

            desc = self._services.get(identifier)
            if desc is None:
                if self._parent is not None:
                    return self._parent.get(identifier, chain)
                raise KeyError(f"Service not registered: {identifier}")

            # Already instantiated singleton
            if desc.has_instance:
                return desc.get_instance()

            # Mark as resolving
            self._resolving.add(identifier)
            try:
                instance = self._create_instance(desc)
            finally:
                self._resolving.discard(identifier)

            if desc.is_singleton:
                desc.set_instance(instance)

            return instance

    def _create_instance(self, desc: _ServiceDescriptor) -> Any:
        """Instantiate from descriptor, injecting constructor args."""
        if desc._factory is not None:
            return desc._factory()

        if desc._ctor is not None:
            # Auto-inject services from type hints if no explicit args
            if not desc._args and not desc._kwargs:
                injected = self._inject_constructor(desc._ctor)
                return desc._ctor(*injected)
            return desc._ctor(*desc._args, **desc._kwargs)

        raise RuntimeError(f"Cannot create instance from descriptor: {desc!r}")

    def _inject_constructor(self, ctor: Type) -> List[Any]:
        """
        Inspect constructor type hints and inject registered services.
        Only injects params that are typed with a ServiceIdentifier.
        Unknown or non-annotated params are skipped (caller must provide).
        """
        try:
            sig = inspect.signature(ctor.__init__)
        except (ValueError, TypeError):
            return []

        injected = []
        params = list(sig.parameters.values())[1:]  # skip 'self'

        for param in params:
            if param.default is not inspect.Parameter.empty:
                # Has default — skip, caller didn't provide
                continue
            if param.kind in (
                inspect.Parameter.VAR_POSITIONAL,
                inspect.Parameter.VAR_KEYWORD,
            ):
                continue
            # Try to resolve by annotation if it's a ServiceIdentifier
            annotation = param.annotation
            if isinstance(annotation, ServiceIdentifier):
                try:
                    injected.append(self.get(annotation))
                except KeyError:
                    injected.append(None)

        return injected

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    def has(self, identifier: ServiceIdentifier) -> bool:
        """Check if a service is registered (including parent containers)."""
        if identifier in self._services:
            return True
        if self._parent is not None:
            return self._parent.has(identifier)
        return False

    def create_child(self) -> "DIContainer":
        """Create a scoped child container that inherits this container's services."""
        return DIContainer(parent=self)

    def list_registered(self) -> List[str]:
        """Return descriptions of all registered services (for debugging)."""
        return [repr(k) for k in self._services]

    def override(self, identifier: ServiceIdentifier, instance: Any) -> None:
        """Override a registered service with a specific instance (useful for testing)."""
        with self._lock:
            self._services[identifier] = _ServiceDescriptor(
                instance=instance, singleton=True
            )


# ---------------------------------------------------------------------------
# Global Application Container
# ---------------------------------------------------------------------------

_global_container: Optional[DIContainer] = None
_container_lock = threading.Lock()


def get_container() -> DIContainer:
    """Return the global application DI container (singleton)."""
    global _global_container
    if _global_container is None:
        with _container_lock:
            if _global_container is None:
                _global_container = DIContainer()
    return _global_container


def reset_container() -> None:
    """Reset the global container — primarily for testing."""
    global _global_container
    with _container_lock:
        _global_container = None


# ---------------------------------------------------------------------------
# Well-known Service Identifiers (IDs)
# Used across the codebase — mirrors VS Code's platform service IDs
# ---------------------------------------------------------------------------

IConfigurationService = create_service_id("IConfigurationService")
ICommandService = create_service_id("ICommandService")
IEventBusService = create_service_id("IEventBusService")
IContextKeyService = create_service_id("IContextKeyService")
IKeybindingService = create_service_id("IKeybindingService")
ILogService = create_service_id("ILogService")
IStorageService = create_service_id("IStorageService")
ILifecycleService = create_service_id("ILifecycleService")
IProgressService = create_service_id("IProgressService")
IURIService = create_service_id("IURIService")
INotificationService = create_service_id("INotificationService")
IThemeService = create_service_id("IThemeService")
IExtensionService = create_service_id("IExtensionService")
IFileService = create_service_id("IFileService")
IDialogService = create_service_id("IDialogService")
IWorkspaceService = create_service_id("IWorkspaceService")
ITerminalService = create_service_id("ITerminalService")
IDebugService = create_service_id("IDebugService")
ISCMService = create_service_id("ISCMService")
IEditorService = create_service_id("IEditorService")
IStatusBarService = create_service_id("IStatusBarService")
IOutputService = create_service_id("IOutputService")
IProblemsService = create_service_id("IProblemsService")
ISearchService = create_service_id("ISearchService")
ITaskService = create_service_id("ITaskService")
IErrorBoundaryService = create_service_id("IErrorBoundaryService")
