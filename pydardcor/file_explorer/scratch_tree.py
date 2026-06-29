import sys
from PySide6.QtWidgets import QApplication, QTreeWidget, QTreeWidgetItem
from PySide6.QtCore import Qt

app = QApplication(sys.argv)

tree = QTreeWidget()
tree.setColumnCount(1)

root1 = QTreeWidgetItem(tree, ["Empty Folder - Hidden Child"])
root1.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
dummy1 = QTreeWidgetItem(root1, ["Hidden"])
dummy1.setHidden(True)

root2 = QTreeWidgetItem(tree, ["Empty Folder - No Hack"])
root2.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)

root3 = QTreeWidgetItem(tree, ["Empty Folder - Empty Text"])
dummy3 = QTreeWidgetItem(root3, [""])
dummy3.setFlags(Qt.NoItemFlags)
# make height 0 to hide it
dummy3.setSizeHint(0, Qt.QSize(0, 0))

tree.show()
sys.exit(app.exec())
