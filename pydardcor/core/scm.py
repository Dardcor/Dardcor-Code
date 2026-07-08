"""Source Control Management (SCM) interfaces."""

from typing import Dict, List, Any, Optional

class SCMResourceGroup:
    """A group of SCM resources, e.g., 'Staged Changes' or 'Merge Conflicts'."""
    def __init__(self, id: str, label: str):
        self.id = id
        self.label = label
        self.resources: List[Dict[str, Any]] = []

class SCMProvider:
    """An SCM provider, e.g., Git, SVN, etc."""
    def __init__(self, id: str, label: str):
        self.id = id
        self.label = label
        self.groups: List[SCMResourceGroup] = []
        self.count = 0

    def get_status(self) -> Dict[str, Any]:
        """Return status information for the provider."""
        return {
            "id": self.id,
            "label": self.label,
            "count": self.count,
            "groups": [{"id": g.id, "label": g.label, "resources": g.resources} for g in self.groups]
        }
        
    def refresh(self):
        """Called to trigger a refresh of the provider's state."""
        pass

class SCMService:
    """Manages registered SCM providers."""
    def __init__(self):
        self._providers: Dict[str, SCMProvider] = {}
        self._active_provider_id: Optional[str] = None

    def register_provider(self, provider: SCMProvider):
        self._providers[provider.id] = provider
        if not self._active_provider_id:
            self._active_provider_id = provider.id

    def unregister_provider(self, provider_id: str):
        if provider_id in self._providers:
            if self._active_provider_id == provider_id:
                self._active_provider_id = None
            del self._providers[provider_id]

    def get_provider(self, provider_id: str) -> Optional[SCMProvider]:
        return self._providers.get(provider_id)

    def get_all_providers(self) -> List[SCMProvider]:
        return list(self._providers.values())

    @property
    def active_provider(self) -> Optional[SCMProvider]:
        if self._active_provider_id:
            return self._providers.get(self._active_provider_id)
        return None

_scm_service = SCMService()

def get_scm_service() -> SCMService:
    return _scm_service
